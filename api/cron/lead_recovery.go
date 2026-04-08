package cron

import (
	"context"
	"encoding/json"
	"log"

	"github.com/shivanand-burli/go-starter-kit/redis"

	"sales-scrapper-backend/api/models"
	"sales-scrapper-backend/api/repository"
	"sales-scrapper-backend/api/service"
)

// LeadRecovery drains lead batches and job status updates from Redis queues.
type LeadRecovery struct {
	leadSvc      *service.LeadService
	jobRepo      *repository.JobRepo
	campaignRepo *repository.CampaignRepo
}

func NewLeadRecovery(leadSvc *service.LeadService, jobRepo *repository.JobRepo, campaignRepo *repository.CampaignRepo) *LeadRecovery {
	return &LeadRecovery{
		leadSvc:      leadSvc,
		jobRepo:      jobRepo,
		campaignRepo: campaignRepo,
	}
}

// Run drains lead_batches and job_status queues each tick.
func (lr *LeadRecovery) Run(ctx context.Context) {
	lr.drainLeads(ctx)
	lr.drainJobStatus(ctx)
}

// drainLeads processes up to 50 lead batches per tick.
func (lr *LeadRecovery) drainLeads(ctx context.Context) {
	for range 50 {
		payload, ok, err := redis.Dequeue(ctx, "lead_batches")
		if err != nil {
			log.Printf("ERROR [lead-recovery] - dequeue lead_batches failed error=%s", err)
			return
		}
		if !ok {
			return // queue empty
		}

		var batch models.LeadBatchRequest
		if err := json.Unmarshal([]byte(payload), &batch); err != nil {
			log.Printf("ERROR [lead-recovery] - unmarshal lead batch failed, dropping error=%s", err)
			continue
		}

		if len(batch.Leads) == 0 {
			continue
		}

		result := lr.leadSvc.ProcessBatch(ctx, batch.JobID, batch.Leads)
		log.Printf("INFO  [lead-recovery] - processed batch job_id=%s inserted=%d merged=%d skipped=%d",
			batch.JobID, result.Inserted, result.Merged, result.Skipped)
	}
}

// drainJobStatus processes up to 50 job status updates per tick.
func (lr *LeadRecovery) drainJobStatus(ctx context.Context) {
	for range 50 {
		payload, ok, err := redis.Dequeue(ctx, "job_status")
		if err != nil {
			log.Printf("ERROR [lead-recovery] - dequeue job_status failed error=%s", err)
			return
		}
		if !ok {
			return
		}

		var req struct {
			JobID      string `json:"job_id"`
			Status     string `json:"status"`
			LeadsFound int    `json:"leads_found"`
			Error      string `json:"error,omitempty"`
		}
		if err := json.Unmarshal([]byte(payload), &req); err != nil {
			log.Printf("ERROR [lead-recovery] - unmarshal job status failed, dropping error=%s", err)
			continue
		}

		if err := lr.jobRepo.UpdateStatus(ctx, req.JobID, req.Status, req.LeadsFound, req.Error); err != nil {
			log.Printf("ERROR [lead-recovery] - update job status failed job_id=%s error=%s", req.JobID, err)
			continue
		}

		// If job completed, increment campaign counters
		if req.Status == "completed" {
			job, err := lr.jobRepo.GetByID(ctx, req.JobID)
			if err == nil && job != nil {
				if err := lr.campaignRepo.IncrementOnJobComplete(ctx, job.CampaignID, req.LeadsFound); err != nil {
					log.Printf("ERROR [lead-recovery] - increment campaign counters failed error=%s", err)
				}
			}
		}

		log.Printf("INFO  [lead-recovery] - job status updated job_id=%s status=%s leads=%d",
			req.JobID, req.Status, req.LeadsFound)
	}
}
