/* Read-only POSIX source capabilities, N-API 8. No paths except literal root
 * and validated single components; no exported fd integers or fs fallbacks.
 * One async operation per capability: concurrent use (including close) fails
 * EBUSY. A strong JS reference pins it until completion. Work touches only its
 * own copy of fd/DIR; capability state is modified on the JS thread only.
 * Filesystem work runs in the Node worker pool, not the JS event loop. */
#define _POSIX_C_SOURCE 200809L
#define NAPI_VERSION 8
#include <node_api.h>
#include <uv.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#if !defined(__linux__) && !defined(__APPLE__)
#error "Source capabilities require audited Linux or Darwin POSIX semantics"
#endif
#if !defined(O_NOFOLLOW) || !defined(O_DIRECTORY) || !defined(O_CLOEXEC)
#error "No fallback for missing descriptor safety flags"
#endif
#define READ_CAP 65536
#define ENTRY_CAP 128
#define DIR_FLAGS (O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
#define ENTRY_FLAGS (O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)

static const napi_type_tag capability_tag = { UINT64_C(0xd5dafb91d845432d), UINT64_C(0x9e8ac3ab2a181db1) };
typedef struct {
  int fd;
  DIR *stream;
  int busy;
  int closed;
} capability;
typedef enum { ROOT, OPEN, STAT, READ, CLOSE, DIRECTORY, ENTRIES, CLOSE_DIRECTORY } operation;
typedef struct {
  operation op;
  napi_async_work work;
  napi_deferred deferred;
  napi_ref owner;
  capability *cap;
  int fd, result_fd, flags, error;
  DIR *stream, *result_stream;
  char name[NAME_MAX + 1];
  struct stat stat;
  size_t length, count;
  union { unsigned char bytes[READ_CAP]; char names[ENTRY_CAP][NAME_MAX + 1]; } data;
} task;

/* POSIX close EINTR must NOT be blindly retried: the descriptor number may
 * already have been released. Capabilities are invalidated regardless. */
static void dispose(capability *cap) {
  if (!cap->closed) {
    if (cap->stream) (void)closedir(cap->stream);
    else if (cap->fd >= 0) (void)close(cap->fd);
    cap->stream = NULL; cap->fd = -1; cap->closed = 1;
  }
}
static void finalize(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  capability *cap = data;
  dispose(cap); free(cap);
}
static napi_value fail(napi_env env, const char *code, const char *message) {
  (void)napi_throw_error(env, code, message); return NULL;
}
static napi_value errno_value(napi_env env, int number) {
  napi_value message, error, code, value;
  const int translated = uv_translate_sys_error(number);
  if (napi_create_string_utf8(env, uv_strerror(translated), NAPI_AUTO_LENGTH, &message) != napi_ok ||
      napi_create_string_utf8(env, uv_err_name(translated), NAPI_AUTO_LENGTH, &code) != napi_ok ||
      napi_create_error(env, code, message, &error) != napi_ok ||
      napi_create_int32(env, number, &value) != napi_ok ||
      napi_set_named_property(env, error, "errno", value) != napi_ok) return NULL;
  return error;
}
static napi_value reject_errno(napi_env env, int error) {
  napi_deferred deferred; napi_value promise, value = errno_value(env, error);
  if (!value || napi_create_promise(env, &deferred, &promise) != napi_ok || napi_reject_deferred(env, deferred, value) != napi_ok)
    return fail(env, "ERR_SOURCE_NAPI", "Cannot reject native source operation");
  return promise;
}
static capability *unwrap(napi_env env, napi_value value) {
  bool matches = false; capability *cap = NULL;
  if (napi_check_object_type_tag(env, value, &capability_tag, &matches) != napi_ok || !matches ||
      napi_unwrap(env, value, (void **)&cap) != napi_ok || !cap) return NULL;
  return cap;
}
static napi_value wrap(napi_env env, int fd, DIR *stream) {
  napi_value object;
  capability *cap = calloc(1, sizeof(*cap));
  if (!cap) return NULL;
  cap->fd = fd; cap->stream = stream;
  if (napi_create_object(env, &object) != napi_ok || napi_type_tag_object(env, object, &capability_tag) != napi_ok ||
      napi_wrap(env, object, cap, finalize, NULL, NULL) != napi_ok) { free(cap); return NULL; }
  return object;
}
static int utf8_valid(const unsigned char *s, size_t length) {
  size_t i = 0;
  while (i < length) {
    uint32_t c = s[i++]; unsigned int extra; uint32_t minimum;
    if (c < 0x80) { if (!c) return 0; continue; }
    if (c >= 0xc2 && c <= 0xdf) { extra = 1; minimum = 0x80; c &= 0x1f; }
    else if (c >= 0xe0 && c <= 0xef) { extra = 2; minimum = 0x800; c &= 0x0f; }
    else if (c >= 0xf0 && c <= 0xf4) { extra = 3; minimum = 0x10000; c &= 0x07; }
    else return 0;
    if (length - i < extra) return 0;
    while (extra--) { unsigned int b = s[i++]; if ((b & 0xc0) != 0x80) return 0; c = (c << 6) | (b & 0x3f); }
    if (c < minimum || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) return 0;
  }
  return 1;
}
/* Reject lone UTF-16 surrogates before N-API's UTF-8 conversion can replace
 * them. Names are neither normalized nor case-folded on either platform. */
static int component(napi_env env, napi_value value, char *name) {
  size_t length = 0, units = 0; uint16_t text[NAME_MAX + 1];
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok || !length || length > NAME_MAX ||
      napi_get_value_string_utf16(env, value, text, NAME_MAX + 1, &units) != napi_ok) return 0;
  for (size_t i = 0; i < units; i++) {
    if (text[i] >= 0xd800 && text[i] <= 0xdbff) {
      if (++i >= units || text[i] < 0xdc00 || text[i] > 0xdfff) return 0;
    } else if (text[i] >= 0xdc00 && text[i] <= 0xdfff) return 0;
  }
  if (napi_get_value_string_utf8(env, value, name, NAME_MAX + 1, &units) != napi_ok || units != length ||
      strlen(name) != length || strchr(name, '/') || !strcmp(name, ".") || !strcmp(name, "..")) return 0;
  return utf8_valid((unsigned char *)name, length);
}
static int open_retry(int parent, const char *name, int flags) {
  int fd;
  do { fd = openat(parent, name, flags); } while (fd < 0 && errno == EINTR);
  return fd;
}
static int stat_retry(int fd, struct stat *s) {
  int result;
  do { result = fstat(fd, s); } while (result < 0 && errno == EINTR);
  return result;
}
static void execute(napi_env env, void *data) {
  (void)env; task *t = data;
  switch (t->op) {
    case ROOT:
      do { t->result_fd = open("/", DIR_FLAGS); } while (t->result_fd < 0 && errno == EINTR);
      if (t->result_fd < 0) t->error = errno;
      break;
    case OPEN:
      t->result_fd = open_retry(t->fd, t->name, t->flags);
      if (t->result_fd < 0) t->error = errno;
      break;
    case STAT:
      if (stat_retry(t->fd, &t->stat) < 0) t->error = errno;
      /* Do not silently collapse identity integers into imprecise doubles. */
      else if ((uint64_t)t->stat.st_dev > UINT64_C(9007199254740991) || (uint64_t)t->stat.st_ino > UINT64_C(9007199254740991) ||
               (uint64_t)t->stat.st_nlink > UINT64_C(9007199254740991) || t->stat.st_size < 0 || (uint64_t)t->stat.st_size > UINT64_C(9007199254740991)) t->error = EOVERFLOW;
      break;
    case READ: {
      struct stat s; ssize_t count;
      if (stat_retry(t->fd, &s) < 0) { t->error = errno; break; }
      if (!S_ISREG(s.st_mode) || s.st_nlink != 1) { t->error = EPERM; break; }
      do { count = read(t->fd, t->data.bytes, t->length); } while (count < 0 && errno == EINTR);
      if (count < 0) t->error = errno; else t->count = (size_t)count;
      break;
    }
    case CLOSE:
      if (close(t->fd) < 0) t->error = errno;
      break;
    case DIRECTORY: {
      int fd = open_retry(t->fd, ".", DIR_FLAGS);
      if (fd < 0) { t->error = errno; break; }
      t->result_stream = fdopendir(fd);
      if (!t->result_stream) { t->error = errno; (void)close(fd); }
      break;
    }
    case ENTRIES:
      while (t->count < ENTRY_CAP) {
        errno = 0; struct dirent *entry = readdir(t->stream);
        if (!entry) { if (errno == EINTR) continue; t->error = errno; break; }
        if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
        size_t length = strnlen(entry->d_name, NAME_MAX + 1);
        if (!length || length > NAME_MAX || strchr(entry->d_name, '/') || !utf8_valid((unsigned char *)entry->d_name, length)) { t->error = EILSEQ; break; }
        memcpy(t->data.names[t->count++], entry->d_name, length + 1);
      }
      break;
    case CLOSE_DIRECTORY:
      if (closedir(t->stream) < 0) t->error = errno;
      break;
  }
}
static int number(napi_env env, napi_value object, const char *name, double n) {
  napi_value value;
  return napi_create_double(env, n, &value) == napi_ok && napi_set_named_property(env, object, name, value) == napi_ok;
}
static napi_value stat_object(napi_env env, const struct stat *s) {
  napi_value value;
#if defined(__APPLE__)
  double mtime = (double)s->st_mtimespec.tv_sec * 1000 + s->st_mtimespec.tv_nsec / 1e6;
  double ctime = (double)s->st_ctimespec.tv_sec * 1000 + s->st_ctimespec.tv_nsec / 1e6;
#else
  double mtime = (double)s->st_mtim.tv_sec * 1000 + s->st_mtim.tv_nsec / 1e6;
  double ctime = (double)s->st_ctim.tv_sec * 1000 + s->st_ctim.tv_nsec / 1e6;
#endif
  if (napi_create_object(env, &value) != napi_ok ||
      !number(env, value, "dev", (double)s->st_dev) || !number(env, value, "ino", (double)s->st_ino) ||
      !number(env, value, "mode", (double)s->st_mode) || !number(env, value, "uid", (double)s->st_uid) ||
      !number(env, value, "gid", (double)s->st_gid) || !number(env, value, "nlink", (double)s->st_nlink) ||
      !number(env, value, "size", (double)s->st_size) || !number(env, value, "mtimeMs", mtime) || !number(env, value, "ctimeMs", ctime)) return NULL;
  return value;
}
static void cleanup(napi_env env, task *t) {
  if (t->result_fd >= 0) (void)close(t->result_fd);
  if (t->result_stream) (void)closedir(t->result_stream);
  if (t->owner) (void)napi_delete_reference(env, t->owner);
  if (t->work) (void)napi_delete_async_work(env, t->work);
  free(t);
}
static void complete(napi_env env, napi_status status, void *data) {
  task *t = data; napi_value value = NULL;
  if (t->cap) {
    t->cap->busy = 0;
    if (t->op == CLOSE || t->op == CLOSE_DIRECTORY) {
      /* Even erroring close invalidates the fd. Never retry a recycled number. */
      if (status == napi_cancelled) dispose(t->cap);
      t->cap->closed = 1; t->cap->fd = -1; t->cap->stream = NULL;
    }
  }
  if (status != napi_ok) t->error = ECANCELED;
  if (!t->error) {
    switch (t->op) {
      case ROOT: case OPEN:
        value = wrap(env, t->result_fd, NULL);
        if (value) t->result_fd = -1;
        break;
      case DIRECTORY:
        value = wrap(env, -1, t->result_stream);
        if (value) t->result_stream = NULL;
        break;
      case STAT: value = stat_object(env, &t->stat); break;
      case READ:
        if (napi_create_buffer_copy(env, t->count, t->data.bytes, NULL, &value) != napi_ok) value = NULL;
        break;
      case ENTRIES:
        if (napi_create_array_with_length(env, t->count, &value) == napi_ok) {
          for (size_t i = 0; i < t->count; i++) {
            napi_value name;
            if (napi_create_string_utf8(env, t->data.names[i], NAPI_AUTO_LENGTH, &name) != napi_ok ||
                napi_set_element(env, value, (uint32_t)i, name) != napi_ok) { value = NULL; break; }
          }
        } else value = NULL;
        break;
      case CLOSE: case CLOSE_DIRECTORY:
        if (napi_get_undefined(env, &value) != napi_ok) value = NULL;
        break;
    }
  }
  if (t->error || !value) {
    napi_value error = errno_value(env, t->error ? t->error : ENOMEM);
    if (error) (void)napi_reject_deferred(env, t->deferred, error);
  } else (void)napi_resolve_deferred(env, t->deferred, value);
  cleanup(env, t);
}
static napi_value invoke(napi_env env, napi_callback_info info) {
  napi_value args[3], promise, label; size_t argc = 3; void *data;
  if (napi_get_cb_info(env, info, &argc, args, NULL, &data) != napi_ok) return fail(env, "ERR_SOURCE_NAPI", "Invalid callback");
  operation op = (operation)(uintptr_t)data;
  size_t expected = op == ROOT ? 0 : op == OPEN ? 3 : op == READ ? 2 : 1;
  if (argc != expected) return reject_errno(env, EINVAL);
  capability *cap = NULL;
  if (op != ROOT) {
    cap = unwrap(env, args[0]);
    if (!cap || cap->closed) return reject_errno(env, EBADF);
    if (cap->busy) return reject_errno(env, EBUSY);
    if ((op == ENTRIES || op == CLOSE_DIRECTORY) != (cap->stream != NULL)) return reject_errno(env, EBADF);
  }
  task *t = calloc(1, sizeof(*t));
  if (!t) return reject_errno(env, ENOMEM);
  t->op = op; t->cap = cap; t->result_fd = -1; t->fd = cap ? cap->fd : -1; t->stream = cap ? cap->stream : NULL;
  if (op == OPEN) {
    char kind[16]; size_t length;
    if (!component(env, args[1], t->name) || napi_get_value_string_utf8(env, args[2], kind, sizeof(kind), &length) != napi_ok ||
        length != strlen(kind) || (strcmp(kind, "directory") && strcmp(kind, "entry"))) { free(t); return reject_errno(env, EINVAL); }
    t->flags = !strcmp(kind, "directory") ? DIR_FLAGS : ENTRY_FLAGS;
  }
  if (op == READ) {
    double length;
    if (napi_get_value_double(env, args[1], &length) != napi_ok || !(length >= 0 && length <= READ_CAP) || length != (size_t)length) {
      free(t); return reject_errno(env, EINVAL);
    }
    t->length = (size_t)length;
  }
  if (napi_create_promise(env, &t->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(env, "fovea:source", NAPI_AUTO_LENGTH, &label) != napi_ok ||
      (cap && napi_create_reference(env, args[0], 1, &t->owner) != napi_ok) ||
      napi_create_async_work(env, NULL, label, execute, complete, t, &t->work) != napi_ok) {
    cleanup(env, t); return fail(env, "ERR_SOURCE_NAPI", "Cannot schedule source operation");
  }
  if (cap) cap->busy = 1;
  if (napi_queue_async_work(env, t->work) != napi_ok) {
    if (cap) cap->busy = 0;
    napi_value error = errno_value(env, ENOMEM);
    if (error) (void)napi_reject_deferred(env, t->deferred, error);
    cleanup(env, t);
  }
  return promise;
}
static napi_value init(napi_env env, napi_value exports) {
  const char *names[] = { "openRoot", "openAt", "stat", "read", "close", "openDirectory", "readDirectory", "closeDirectory" };
  for (uintptr_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
    napi_value fn;
    if (napi_create_function(env, names[i], NAPI_AUTO_LENGTH, invoke, (void *)i, &fn) != napi_ok ||
        napi_set_named_property(env, exports, names[i], fn) != napi_ok) return fail(env, "ERR_SOURCE_NAPI", "Cannot initialize binding");
  }
  napi_value platform;
#if defined(__APPLE__)
  const char *name = "darwin";
#else
  const char *name = "linux";
#endif
  if (!number(env, exports, "abiVersion", 1) || napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &platform) != napi_ok ||
      napi_set_named_property(env, exports, "platform", platform) != napi_ok) return fail(env, "ERR_SOURCE_NAPI", "Cannot initialize binding ABI");
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
