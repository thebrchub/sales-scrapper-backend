package service

import "sales-scrapper-backend/api/models"

// Calculate returns a lead score (0-100) based on signals.
func ScoreCalculate(lead models.RawLead, existing *models.Lead) int {
	score := 0

	// No website → high potential customer
	if lead.WebsiteURL == nil || *lead.WebsiteURL == "" {
		score += 30
	}

	// No SSL
	if lead.HasSSL != nil && !*lead.HasSSL {
		score += 10
	}

	// Has tech stack data suggesting outdated tech
	if len(lead.TechStack) > 0 {
		score += 20
	}

	// Found on multiple sources
	if existing != nil && len(existing.Source) >= 1 {
		score += 10
	}

	// Has mobile-friendly data
	if lead.IsMobileFriendly != nil && !*lead.IsMobileFriendly {
		score += 10
	}

	// Has phone number
	if lead.Phone != nil && *lead.Phone != "" {
		score += 5
	}

	if score > 100 {
		score = 100
	}
	return score
}
