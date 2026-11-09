package urmin

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestR3BFileValidation(t *testing.T) {
	var buf bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	img.Set(1, 1, color.RGBA{1, 2, 3, 255})
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	valid := []struct {
		name  string
		blob  []byte
		media string
	}{
		{"scan.png", buf.Bytes(), "image/png"},
		{"notice.pdf", []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"), "application/pdf"},
	}
	for _, v := range valid {
		got, ok := validateFile(v.name, v.blob)
		if !ok || got != v.media {
			t.Fatalf("valid rejected: %s got=%q", v.name, got)
		}
	}
	invalid := []struct {
		name string
		blob []byte
	}{
		{"../evil.pdf", []byte("%PDF-1.7\n%%EOF")},
		{"script.svg", []byte(`<svg><script>bad()</script></svg>`)},
		{"program.pdf", []byte("not a pdf")},
		{"truncated.pdf", []byte("%PDF-1.7 without EOF")},
		{"fake.png", []byte("not an image")},
		{"image.pdf", buf.Bytes()},
		{"ok.pdf", make([]byte, maxAttachmentSize+1)},
	}
	for _, v := range invalid {
		if _, ok := validateFile(v.name, v.blob); ok {
			t.Fatalf("unsafe file accepted: %s", v.name)
		}
	}
}
