package service

import (
	"regexp"
	"strings"
)

var phoneCleanRe = regexp.MustCompile(`[^\d+]`)

// NormalizePhone strips non-digit characters (keeping leading +) for basic E.164 normalization.
func NormalizePhone(phone string) string {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return ""
	}
	hasPlus := strings.HasPrefix(phone, "+")
	cleaned := phoneCleanRe.ReplaceAllString(phone, "")
	if hasPlus && !strings.HasPrefix(cleaned, "+") {
		cleaned = "+" + cleaned
	}
	return cleaned
}

// ValidatePhoneFormat checks basic E.164 format: +{country}{number}, 7-15 digits.
func ValidatePhoneFormat(phone string) bool {
	if !strings.HasPrefix(phone, "+") {
		return false
	}
	digits := phone[1:]
	if len(digits) < 7 || len(digits) > 15 {
		return false
	}
	for _, c := range digits {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// DetectPhoneType returns a basic phone type guess based on known patterns.
func DetectPhoneType(phone string) string {
	// Simplified — real implementation would use libphonenumber data
	if strings.HasPrefix(phone, "+1800") || strings.HasPrefix(phone, "+1888") || strings.HasPrefix(phone, "+1877") {
		return "toll_free"
	}
	return "unknown"
}

// PhoneConfidence calculates a confidence score for the phone number.
func PhoneConfidence(valid bool, phoneType string, multiSource bool) int {
	score := 0
	if valid {
		score += 25
	}
	if multiSource {
		score += 30
	}
	if phoneType == "mobile" || phoneType == "landline" {
		score += 20
	}
	return score
}
