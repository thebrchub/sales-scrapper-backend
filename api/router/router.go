package router

import (
	"net/http"
	"time"

	"github.com/shivanand-burli/go-starter-kit/middleware"

	"sales-scrapper-backend/api/config"
	"sales-scrapper-backend/api/handler"
)

func New(cfg config.Config, authH *handler.AuthHandler, leadH *handler.LeadHandler, campaignH *handler.CampaignHandler, exportH *handler.ExportHandler, progressH *handler.ProgressHandler) (http.Handler, *middleware.IPRateLimiter) {
	mux := http.NewServeMux()
	auth := middleware.Auth("")

	// Public — no auth
	mux.HandleFunc("POST /auth/login", authH.Login)
	mux.HandleFunc("POST /auth/refresh", middleware.HandleRefresh(""))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Protected — any authenticated user
	mux.HandleFunc("GET /leads", middleware.Chain(leadH.GetLeads, auth))
	mux.HandleFunc("GET /leads/{id}", middleware.Chain(leadH.GetLead, auth))
	mux.HandleFunc("PATCH /leads/{id}", middleware.Chain(leadH.UpdateLead, auth))
	mux.HandleFunc("GET /leads/export", middleware.Chain(exportH.ExportCSV, auth))
	mux.HandleFunc("POST /campaigns", middleware.Chain(campaignH.CreateCampaign, auth))
	mux.HandleFunc("GET /campaigns", middleware.Chain(campaignH.GetCampaigns, auth))
	mux.HandleFunc("GET /campaigns/{id}/status", middleware.Chain(campaignH.GetCampaignStatus, auth))
	mux.HandleFunc("GET /campaigns/{id}/progress", middleware.Chain(progressH.StreamProgress, auth))

	// Middleware stack
	cors := middleware.NewCORS(middleware.CORSConfig{
		Origin:  cfg.CORSOrigin,
		Headers: "Content-Type, Authorization",
	})

	limiter := middleware.NewIPRateLimiter(cfg.RateLimitRPS, cfg.RateLimitBurst)

	cb := middleware.NewCircuitBreaker(middleware.CircuitBreakerConfig{
		FailureThreshold: cfg.CBFailureThreshold,
		OpenDuration:     time.Duration(cfg.CBOpenDurationSec) * time.Second,
	})

	// Middleware stack (inside → outside): mux → compress → cors → rate limiter → circuit breaker
	var h http.Handler = mux
	h = middleware.Compress(h)
	h = cors(h)
	h = limiter.LimitHandler(h)
	h = cb.Wrap(h)

	return h, limiter
}
