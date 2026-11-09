package auth

import "testing"

func TestProofOfWork(t *testing.T) {
	nonce := "local-test-nonce"
	var found uint32
	for i := uint32(0); i < 1000000; i++ {
		if proofIsValid(nonce, i) {
			found = i
			break
		}
	}
	if !proofIsValid(nonce, found) {
		t.Fatal("valid puzzle cannot be solved")
	}
	if proofIsValid(nonce, 5000001) {
		t.Fatal("counter upper bound bypassed")
	}
	if proofIsValid(nonce+"tampered", found) {
		t.Fatal("tampered nonce accepted")
	}
}
func TestOTPPolicy(t *testing.T) {
	if !mustUseOTP(false, true) {
		t.Fatal("Superadmin OTP bypass")
	}
	if !mustUseOTP(true, false) {
		t.Fatal("non-admin default OTP bypass")
	}
	if mustUseOTP(false, false) {
		t.Fatal("OTP-disabled account forced OTP")
	}
}
