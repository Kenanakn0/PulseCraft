package realtime

import (
	"encoding/json"
	"strings"
	"testing"
)

// WS istemcilerine giden alarm olayı, "incelemeye alan" kullanıcıyı taşımalı;
// alan yalnızca acknowledged olayında dolu olduğu için diğerlerinde JSON'da yer almamalı.
func TestAlertEvent_AcknowledgedByInJSON(t *testing.T) {
	acked, err := json.Marshal(AlertEvent{Type: "alert", Event: "acknowledged", AlertID: 1, AcknowledgedBy: "Ada Test"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(acked), `"acknowledged_by":"Ada Test"`) {
		t.Errorf("acknowledged olayı kullanıcıyı taşımalı: %s", acked)
	}

	opened, err := json.Marshal(AlertEvent{Type: "alert", Event: "opened", AlertID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(opened), "acknowledged_by") {
		t.Errorf("opened olayında acknowledged_by olmamalı: %s", opened)
	}
}
