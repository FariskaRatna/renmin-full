package subbagren

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"
)

// SDL1 versioned envelope: AES-256-GCM, random 96-bit nonce, authenticated payload.
// The key is an independent, externally configured 32-byte secret. No plaintext fallback.
var evidenceEnvelope = []byte("SDL1")
var errEvidenceKey = errors.New("financial evidence encryption key unavailable")

func sealEvidence(key, data []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, errEvidenceKey
	}
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
	if len(key) != 32 {
		return nil, errEvidenceKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	start := len(evidenceEnvelope) + gcm.NonceSize()
	if len(encoded) < start+gcm.Overhead() || !bytes.Equal(encoded[:len(evidenceEnvelope)], evidenceEnvelope) {
		return nil, errors.New("invalid encrypted evidence envelope")
	}
	return gcm.Open(nil, encoded[len(evidenceEnvelope):start], encoded[start:], evidenceEnvelope)
}
