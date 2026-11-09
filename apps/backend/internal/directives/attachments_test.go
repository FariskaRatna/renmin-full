package directives

import "testing"

func TestValidDirectiveFileRejectsSpoofedContent(t *testing.T) {
 for _, tc := range []struct{name string;data []byte}{
  {"evil.pdf",[]byte("<script>invalid</script>")},
  {"evil.png",[]byte("%PDF-1.7\n%%EOF")},
  {"test.exe",[]byte("%PDF-1.7\n%%EOF")},
  {"../../test.pdf",[]byte("%PDF-1.7\n%%EOF")},
  {"test\r\n.pdf",[]byte("%PDF-1.7\n%%EOF")},
  {"",[]byte("%PDF-1.7\n%%EOF")},
 } {
  if got, ok := validDirectiveFile(tc.name,tc.data); ok {t.Errorf("unsafe %q accepted as %s",tc.name,got)}
 }
}
func TestValidDirectivePDF(t *testing.T) {
 kind, ok := validDirectiveFile("instruction.pdf",[]byte("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"))
 if !ok || kind!="application/pdf"{t.Fatalf("valid PDF rejected: %v %s",ok,kind)}
}
