package directives

import (
	"testing"
	"time"
)

func TestValidateDirectInstruction(t *testing.T) {
	ids := []string{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
	p := createRequest{Title: "Penyiapan surat tugas", Body: "Siapkan dokumen penugasan sesuai arahan rapat.", Kind: "sprint", Priority: "penting", Recipients: ids}
	if !validate(p, time.Now()) {
		t.Fatal("valid direct order rejected")
	}
	p.Recipients = []string{}
	if validate(p, time.Now()) {
		t.Fatal("zero recipient accepted")
	}
	p.Recipients = make([]string, 11)
	for i := range p.Recipients {
		p.Recipients[i] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	}
	if validate(p, time.Now()) {
		t.Fatal("11 recipients accepted")
	}
	p.Recipients = append(ids, ids[0])
	if validate(p, time.Now()) {
		t.Fatal("duplicate accepted")
	}
	p.Recipients = ids
	p.Kind = "chat"
	if validate(p, time.Now()) {
		t.Fatal("chat mode accepted")
	}
}
