// Alat uji silang R5H2: menjalankan decode + validSheet + normalizeSheet dan
// decodeSheet milik Go yang ASLI (directives/sheet.go) atas kasus yang sama
// dengan verify/r5h2-sheet-parity.js.
//
// Disalin ke internal/directives/ di dalam container golang atas SALINAN
// source backend, lalu dijalankan dengan `go test -run TestR5H2SheetParity`.
// Tidak ada berkas yang ditambahkan ke apps/backend.
//
// Protokol: satu kasus per baris di berkas $R5H2_CASES, dipisah TAB.
//   input<TAB>body JSON   -> R5H2<TAB>reject | R5H2<TAB>ok<TAB><sheet ternormalisasi>
//   stored<TAB>jsonb      -> R5H2<TAB>error  | R5H2<TAB>ok<TAB><sheet ter-decode>
// Keluaran memakai SetEscapeHTML(false) supaya yang dibandingkan adalah isi
// dan URUTAN KUNCI; beda escape HTML adalah urusan writeJson, bukan sheet.js.
package directives

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
)

func r5h2Encode(v any) string {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
	return strings.TrimSuffix(b.String(), "\n")
}

func TestR5H2SheetParity(t *testing.T) {
	path := os.Getenv("R5H2_CASES")
	if path == "" {
		t.Skip("R5H2_CASES tidak diisi")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		mode, body, _ := strings.Cut(sc.Text(), "\t")
		switch mode {
		case "input":
			var p struct {
				Sheet *sheet `json:"sheet"`
			}
			dec := json.NewDecoder(strings.NewReader(body))
			dec.DisallowUnknownFields()
			if dec.Decode(&p) != nil || dec.Decode(new(any)) != io.EOF || !validSheet(p.Sheet) {
				fmt.Println("R5H2\treject")
				continue
			}
			fmt.Printf("R5H2\tok\t%s\n", r5h2Encode(normalizeSheet(p.Sheet)))
		case "stored":
			s, err := decodeSheet([]byte(body))
			if err != nil {
				fmt.Println("R5H2\terror")
				continue
			}
			fmt.Printf("R5H2\tok\t%s\n", r5h2Encode(s))
		default:
			t.Fatalf("mode tidak dikenal: %q", mode)
		}
	}
}
