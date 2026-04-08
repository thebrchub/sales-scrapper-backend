package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/shivanand-burli/go-starter-kit/helper"
	"github.com/shivanand-burli/go-starter-kit/redis"
)

type ProgressHandler struct{}

func NewProgressHandler() *ProgressHandler {
	return &ProgressHandler{}
}

// StreamProgress streams campaign progress updates via Server-Sent Events.
// Subscribes to redis pub/sub "lead_updates" and forwards messages matching the campaign ID.
func (h *ProgressHandler) StreamProgress(w http.ResponseWriter, r *http.Request) {
	campaignID := r.PathValue("id")
	if campaignID == "" {
		helper.Error(w, http.StatusBadRequest, "missing campaign id")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		helper.Error(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()

	sub := redis.Subscribe(r.Context(), "lead_updates")
	if sub == nil {
		helper.Error(w, http.StatusServiceUnavailable, "redis not available")
		return
	}
	defer sub.Close()

	ch := sub.Channel()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}

			// Filter by campaign ID — message payload is JSON with campaign_id field
			var payload struct {
				CampaignID string `json:"campaign_id"`
			}
			if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
				log.Printf("WARN  [api] - progress: invalid payload error=%s", err)
				continue
			}
			if payload.CampaignID != campaignID {
				continue
			}

			fmt.Fprintf(w, "data: %s\n\n", msg.Payload)
			flusher.Flush()
		}
	}
}
