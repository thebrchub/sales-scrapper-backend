package models

import "time"

type ScrapeJob struct {
	ID             string     `db:"id" json:"id"`
	CampaignID     string     `db:"campaign_id" json:"campaign_id"`
	Source         string     `db:"source" json:"source"`
	City           string     `db:"city" json:"city"`
	Category       string     `db:"category" json:"category"`
	Status         string     `db:"status" json:"status"`
	AttemptCount   int        `db:"attempt_count" json:"attempt_count"`
	MaxAttempts    int        `db:"max_attempts" json:"max_attempts"`
	TimeoutSeconds int        `db:"timeout_seconds" json:"timeout_seconds"`
	LeadsFound     int        `db:"leads_found" json:"leads_found"`
	LastError      *string    `db:"last_error" json:"last_error,omitempty"`
	StartedAt      *time.Time `db:"started_at" json:"started_at,omitempty"`
	CompletedAt    *time.Time `db:"completed_at" json:"completed_at,omitempty"`
	DiedAt         *time.Time `db:"died_at" json:"died_at,omitempty"`
	CreatedAt      time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at" json:"updated_at"`
}
