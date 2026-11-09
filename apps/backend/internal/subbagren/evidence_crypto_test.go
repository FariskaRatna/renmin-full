package subbagren

import (
 "bytes"
 "testing"
)
func TestFinancialEvidenceEncryptionFailsClosed(t *testing.T){
 k:=bytes.Repeat([]byte{0x5a},32)
 p:=[]byte("internal financial evidence content")
 enc,err:=sealEvidence(k,p);if err!=nil{t.Fatal(err)}
 if bytes.Contains(enc,p){t.Fatal("unencrypted financial evidence")}
 got,err:=openEvidence(k,enc);if err!=nil||!bytes.Equal(got,p){t.Fatal("unable to decrypt unchanged evidence",err)}
 enc[20]^=1
 if _,err:=openEvidence(k,enc);err==nil{t.Fatal("tampered ciphertext authenticated")}
 if _,err:=openEvidence(nil,enc);err==nil{t.Fatal("missing key accepted")}
 if _,err:=sealEvidence(nil,p);err==nil{t.Fatal("missing key allowed upload")}
}
func TestEvidenceFileTypeValidation(t *testing.T){
 for _,tc:=range []struct{file string;raw []byte}{
  {"receipt.png",[]byte("javascript disguised as png")},
  {"../../evil.pdf",[]byte("%PDF-1.7\n%%EOF")},
  {"receipt.exe",[]byte("danger")},
 }{if _,ok:=validateEvidence(tc.file,tc.raw);ok{t.Fatalf("unsafe file accepted %s",tc.file)}}
}
