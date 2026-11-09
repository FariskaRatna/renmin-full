package auth

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func TestProfileValidation(t *testing.T) {
	for _, name := range []string{"", "ab", "invalid\nname", strings.Repeat("x", 161)} {
		if validProfileName(name) {
			t.Errorf("invalid name accepted")
		}
	}
	if !validProfileName("SA SDL") || !validProfilePhone("+62 812-3456 7890") || validProfilePhone("123<script>") {
		t.Fatal("profile validation failure")
	}
	for _, email := range []string{"missing-at", "broken\n@example.com", "Foo <foo@example.com>"} {
		if validProfileEmail(email) {
			t.Fatal("unsafe email accepted")
		}
	}
	if !validProfileEmail("myprofile@example.org") {
		t.Fatal("valid email rejected")
	}
}
func TestAvatarReencodedAndValidated(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 160, 120))
	for y := 0; y < 120; y++ {
		for x := 0; x < 160; x++ {
			img.Set(x, y, color.RGBA{R: 180, G: 120, B: 90, A: 255})
		}
	}
	var input bytes.Buffer
	if err := png.Encode(&input, img); err != nil {
		t.Fatal(err)
	}
	encoded, err := avatarJPEG(input.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	result, err := jpeg.Decode(bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	if result.Bounds().Dx() != 256 || result.Bounds().Dy() != 256 {
		t.Fatal("avatar was not cropped to 256 square")
	}
	if _, err = avatarJPEG([]byte("not an image")); err == nil {
		t.Fatal("garbage image accepted")
	}
	if _, err = avatarJPEG(make([]byte, maxAvatarUpload+1)); err == nil {
		t.Fatal("oversized upload accepted")
	}
	tiny := image.NewRGBA(image.Rect(0, 0, 5, 5))
	var p bytes.Buffer
	_ = png.Encode(&p, tiny)
	if _, err = avatarJPEG(p.Bytes()); err == nil {
		t.Fatal("tiny image accepted")
	}
}
