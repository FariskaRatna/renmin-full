// Alat uji silang Tahap 1: menjalankan primitif kripto Go yang asli supaya
// implementasi Node bisa dibandingkan dua arah.
//
// Dijalankan di dalam container golang atas SALINAN source backend. Tidak ada
// berkas yang ditambahkan ke repositori.
//
// Protokol: satu perintah per baris di stdin, dipisah TAB.
//   hash<TAB>password                  -> hash<TAB><string PHC>
//   verify<TAB>password<TAB>encoded    -> verify<TAB>true|false
//   sign<TAB>secretHex<TAB>purpose<TAB>value -> sign<TAB><hex>
//   seal<TAB>keyHex<TAB>plaintextHex   -> seal<TAB><hex ciphertext>
//   open<TAB>keyHex<TAB>cipherHex      -> open<TAB><hex plaintext>|ERROR
package main

import (
	"bufio"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"siera-delta-lima/backend/internal/auth"
)

// Salinan persis dari internal/auth/service.go:68 — signature().
// Perhatikan byte pemisah 0x00 antara purpose dan value.
func signature(secret []byte, purpose, value string) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(purpose))
	m.Write([]byte{0})
	m.Write([]byte(value))
	return hex.EncodeToString(m.Sum(nil))
}

// Salinan persis dari internal/subbagren/evidence_crypto.go.
var evidenceEnvelope = []byte("SDL1")

func sealEvidence(key, data []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	out := make([]byte, 0, len(evidenceEnvelope)+len(nonce)+len(data)+gcm.Overhead())
	out = append(out, evidenceEnvelope...)
	out = append(out, nonce...)
	return gcm.Seal(out, nonce, data, evidenceEnvelope), nil
}

func openEvidence(key, encoded []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	start := len(evidenceEnvelope) + gcm.NonceSize()
	if len(encoded) < start+gcm.Overhead() || string(encoded[:len(evidenceEnvelope)]) != string(evidenceEnvelope) {
		return nil, fmt.Errorf("invalid encrypted evidence envelope")
	}
	return gcm.Open(nil, encoded[len(evidenceEnvelope):start], encoded[start:], evidenceEnvelope)
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()

	for {
		line, err := reader.ReadString('\n')
		line = strings.TrimRight(line, "\r\n")
		if line != "" {
			handle(writer, line)
		}
		if err != nil {
			return
		}
	}
}

func handle(w *bufio.Writer, line string) {
	parts := strings.Split(line, "\t")
	switch parts[0] {
	case "hash":
		encoded, err := auth.HashPassword(parts[1])
		if err != nil {
			fmt.Fprintf(w, "hash\tERROR %v\n", err)
			return
		}
		fmt.Fprintf(w, "hash\t%s\n", encoded)

	case "verify":
		fmt.Fprintf(w, "verify\t%v\n", auth.VerifyPassword(parts[2], parts[1]))

	// Mem-parse JSON mentah ke any lalu me-marshal ulang — persis perlakuan
	// yang dialami kolom fields jsonb di outgoingContentHash. Hasilnya dikirim
	// sebagai hex supaya byte apa pun selamat melewati protokol baris ini.
	case "gojson":
		var value any
		if e := json.Unmarshal([]byte(parts[1]), &value); e != nil {
			fmt.Fprintf(w, "gojson\tERROR %v\n", e)
			return
		}
		out, e := json.Marshal(value)
		if e != nil {
			fmt.Fprintf(w, "gojson\tERROR %v\n", e)
			return
		}
		fmt.Fprintf(w, "gojson\t%s\n", hex.EncodeToString(out))

	// Pesan notifikasi utuh, berikut amplop MIME-nya. Dikirim sebagai hex
	// supaya CRLF dan byte quoted-printable selamat melewati protokol baris
	// ini; sisi Node yang membongkar dan membandingkan tiap bagiannya.
	case "notif":
		out, err := auth.ExportNotificationEmail(parts[1], parts[2], parts[3], parts[4])
		if err != nil {
			fmt.Fprintf(w, "notif\tERROR %v\n", err)
			return
		}
		fmt.Fprintf(w, "notif\t%s\n", hex.EncodeToString([]byte(out)))

	case "sign":
		secret, err := hex.DecodeString(parts[1])
		if err != nil {
			fmt.Fprintf(w, "sign\tERROR %v\n", err)
			return
		}
		fmt.Fprintf(w, "sign\t%s\n", signature(secret, parts[2], parts[3]))

	case "seal":
		key, _ := hex.DecodeString(parts[1])
		data, _ := hex.DecodeString(parts[2])
		out, err := sealEvidence(key, data)
		if err != nil {
			fmt.Fprintf(w, "seal\tERROR %v\n", err)
			return
		}
		fmt.Fprintf(w, "seal\t%s\n", hex.EncodeToString(out))

	case "open":
		key, _ := hex.DecodeString(parts[1])
		blob, _ := hex.DecodeString(parts[2])
		out, err := openEvidence(key, blob)
		if err != nil {
			fmt.Fprintf(w, "open\tERROR %v\n", err)
			return
		}
		fmt.Fprintf(w, "open\t%s\n", hex.EncodeToString(out))

	default:
		fmt.Fprintf(w, "%s\tERROR perintah tidak dikenal\n", parts[0])
	}
}
