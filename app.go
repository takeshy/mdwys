package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"mime"
	"os"
	"path/filepath"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
}

type LocalFileResult struct {
	Path     string `json:"path"`
	FileName string `json:"fileName"`
	Content  string `json:"content"`
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) SelectLocalFile() (*LocalFileResult, error) {
	path, err := a.SelectLocalFilePath()
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}
	return readLocalFile(path)
}

func (a *App) SelectLocalFilePath() (string, error) {
	path, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Open File",
		Filters: []wailsruntime.FileFilter{
			{
				DisplayName: "Documents and images",
				Pattern:     "*.md;*.markdown;*.txt;*.html;*.htm;*.epub;*.pdf;*.png;*.jpg;*.jpeg;*.gif;*.webp;*.avif;*.bmp;*.svg",
			},
			{DisplayName: "All files", Pattern: "*.*"},
		},
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) SelectExternalEditor() (string, error) {
	return wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Select External Editor",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Applications", Pattern: "*.exe;*.cmd;*.bat;*.ps1;*.app;*"},
			{DisplayName: "All files", Pattern: "*.*"},
		},
	})
}

func (a *App) ReadLocalFile(path string) (*LocalFileResult, error) {
	return readLocalFile(path)
}

func (a *App) StartupFilePaths() []string {
	paths := make([]string, 0, len(os.Args)-1)
	for _, arg := range os.Args[1:] {
		if arg == "" {
			continue
		}
		path, err := filepath.Abs(arg)
		if err != nil {
			continue
		}
		stat, err := os.Stat(path)
		if err != nil || stat.IsDir() {
			continue
		}
		paths = append(paths, path)
	}
	return paths
}

func (a *App) OpenExternalEditor(editorPath string, filePath string) error {
	if editorPath == "" {
		return fmt.Errorf("external editor path is empty")
	}
	if filePath == "" {
		return fmt.Errorf("file path is empty")
	}
	return startExternalEditor(editorPath, filePath)
}

func readLocalFile(path string) (*LocalFileResult, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	fileName := filepath.Base(path)
	content := string(bytes)
	if shouldReadAsDataURL(fileName) {
		mimeType := mime.TypeByExtension(stringsToLower(filepath.Ext(fileName)))
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		content = "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(bytes)
	}

	return &LocalFileResult{
		Path:     path,
		FileName: fileName,
		Content:  content,
	}, nil
}

func shouldReadAsDataURL(fileName string) bool {
	switch stringsToLower(filepath.Ext(fileName)) {
	case ".avif", ".bmp", ".epub", ".gif", ".jpg", ".jpeg", ".pdf", ".png", ".svg", ".webp":
		return true
	default:
		return false
	}
}

func stringsToLower(value string) string {
	out := []rune(value)
	for i, r := range out {
		if r >= 'A' && r <= 'Z' {
			out[i] = r + ('a' - 'A')
		}
	}
	return string(out)
}
