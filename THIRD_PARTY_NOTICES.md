# Third-party notices

Kiro Fabric includes or bundles software distributed under its respective open-source license:

- QuickJS Emscripten packages (`@jitl/quickjs-singlefile-mjs-release-sync`, `quickjs-emscripten-core`)
- Model Context Protocol SDK (`@modelcontextprotocol/sdk`)
- Mcporter (`mcporter`)
- TypeBox (`typebox`)
- TypeScript (`typescript`)
- esbuild and Vitest for development and verification

Exact packaged dependency names and versions are recorded by the generated Agent SBOM.

## pi-fovea native core

`src/fovea/core/` and the attributed Fovea test corpus are derived from
[monotykamary/pi-fovea](https://github.com/monotykamary/pi-fovea), pinned at
`b594483868d27b7eb37a9b185c59ce812f8a9c01` (v0.29.2). Fabric replaces its
hosting, state ownership, executable discovery, source access and delivery
integration. The upstream license follows (also in
`src/fovea/core/UPSTREAM-LICENSE.txt`).

MIT License

Copyright (c) 2026 pi-fovea contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
