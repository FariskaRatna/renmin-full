package main

import (
	"strings"
	"testing"
)

func TestReadInput(t *testing.T) {
	cases := []struct {
		text string
		ok   bool
	}{
		{"13\nabcdefghijklmn\n", true},
		{"13\nshort\n", false},
		{"0\nabcdefghijklmn\n", false},
		{"13\nabcdefghijklmn\nmore\n", false},
		{"99999\nabcdefghijklmn\n", false},
		{"13\nabcdefghijklm\r\n", false},
	}
	for _, tc := range cases {
		_, _, err := readInput(strings.NewReader(tc.text))
		if (err == nil) != tc.ok {
			t.Fatalf("unexpected result for input shape: %v", err)
		}
	}
}
