package repository

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/shivanand-burli/go-starter-kit/postgress"
	"github.com/shivanand-burli/go-starter-kit/redis"

	"sales-scrapper-backend/api/models"
)

type LeadRepo struct {
	leadTTL   time.Duration
	filterTTL time.Duration
}

func NewLeadRepo(leadTTL, filterTTL time.Duration) *LeadRepo {
	return &LeadRepo{leadTTL: leadTTL, filterTTL: filterTTL}
}

func (r *LeadRepo) Insert(ctx context.Context, lead models.Lead) (any, error) {
	return postgress.Insert(ctx, "leads", lead)
}

func (r *LeadRepo) InsertBatch(ctx context.Context, leads []models.Lead) ([]int64, error) {
	ids, err := postgress.InsertBatch(ctx, "leads", leads)
	if err == nil {
		r.invalidateFilterCache(ctx)
	}
	return ids, err
}

func (r *LeadRepo) GetByID(ctx context.Context, id string) (*models.Lead, error) {
	lead, err := redis.Fetch(ctx, "lead:"+id, r.leadTTL, func(ctx context.Context) (*models.Lead, error) {
		var l models.Lead
		found, err := postgress.Get(ctx, "leads", id, &l)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, nil
		}
		return &l, nil
	})
	if err != nil {
		return nil, err
	}
	return lead, nil
}

type filteredResult struct {
	Leads []models.Lead `json:"leads"`
	Total int           `json:"total"`
}

func (r *LeadRepo) GetFiltered(ctx context.Context, city, status, source string, scoreGTE int, hasPhone bool, page, pageSize int) ([]models.Lead, int, error) {
	cacheKey := fmt.Sprintf("leads:filter:%x", sha256.Sum256(
		[]byte(fmt.Sprintf("%s|%s|%s|%d|%v|%d|%d", city, status, source, scoreGTE, hasPhone, page, pageSize)),
	))

	result, err := redis.Fetch(ctx, cacheKey, r.filterTTL, func(ctx context.Context) (*filteredResult, error) {
		where := "1=1"
		args := []any{}
		argIdx := 1

		if city != "" {
			where += fmt.Sprintf(" AND city = $%d", argIdx)
			args = append(args, city)
			argIdx++
		}
		if status != "" {
			where += fmt.Sprintf(" AND status = $%d", argIdx)
			args = append(args, status)
			argIdx++
		}
		if source != "" {
			where += fmt.Sprintf(" AND $%d = ANY(source)", argIdx)
			args = append(args, source)
			argIdx++
		}
		if scoreGTE > 0 {
			where += fmt.Sprintf(" AND lead_score >= $%d", argIdx)
			args = append(args, scoreGTE)
			argIdx++
		}
		if hasPhone {
			where += " AND phone_valid = true"
		}

		countSQL := "SELECT COUNT(*) FROM leads WHERE " + where
		rows, err := postgress.Query[struct {
			Count int `db:"count"`
		}](ctx, countSQL, args...)
		if err != nil {
			return nil, err
		}
		total := 0
		if len(rows) > 0 {
			total = rows[0].Count
		}

		offset := (page - 1) * pageSize
		dataSQL := fmt.Sprintf("SELECT * FROM leads WHERE %s ORDER BY lead_score DESC LIMIT $%d OFFSET $%d", where, argIdx, argIdx+1)
		args = append(args, pageSize, offset)
		leads, err := postgress.Query[models.Lead](ctx, dataSQL, args...)
		if err != nil {
			return nil, err
		}
		return &filteredResult{Leads: leads, Total: total}, nil
	})
	if err != nil {
		return nil, 0, err
	}
	if result == nil {
		return nil, 0, nil
	}
	return result.Leads, result.Total, nil
}

func (r *LeadRepo) Update(ctx context.Context, lead models.Lead) error {
	err := postgress.Update(ctx, "leads", lead)
	if err != nil {
		return err
	}
	redis.Remove(ctx, "lead:"+lead.ID)
	r.invalidateFilterCache(ctx)
	return nil
}

func (r *LeadRepo) FindByPhone(ctx context.Context, phone string) (*models.Lead, error) {
	leads, err := postgress.Query[models.Lead](ctx, "SELECT * FROM leads WHERE phone_e164 = $1 LIMIT 1", phone)
	if err != nil {
		return nil, err
	}
	if len(leads) == 0 {
		return nil, nil
	}
	return &leads[0], nil
}

func (r *LeadRepo) FindByEmail(ctx context.Context, email string) (*models.Lead, error) {
	leads, err := postgress.Query[models.Lead](ctx, "SELECT * FROM leads WHERE LOWER(email) = LOWER($1) LIMIT 1", email)
	if err != nil {
		return nil, err
	}
	if len(leads) == 0 {
		return nil, nil
	}
	return &leads[0], nil
}

func (r *LeadRepo) FindByDomain(ctx context.Context, domain string) (*models.Lead, error) {
	leads, err := postgress.Query[models.Lead](ctx, "SELECT * FROM leads WHERE website_domain = $1 LIMIT 1", domain)
	if err != nil {
		return nil, err
	}
	if len(leads) == 0 {
		return nil, nil
	}
	return &leads[0], nil
}

func (r *LeadRepo) MergeSources(ctx context.Context, id string, newSources []string) error {
	_, err := postgress.Exec(ctx,
		"UPDATE leads SET source = ARRAY(SELECT DISTINCT unnest(source || $1)) WHERE id = $2",
		newSources, id,
	)
	if err == nil {
		redis.Remove(ctx, "lead:"+id)
		r.invalidateFilterCache(ctx)
	}
	return err
}

// invalidateFilterCache removes the filter cache version key so all filter queries re-fetch.
func (r *LeadRepo) invalidateFilterCache(ctx context.Context) {
	redis.Remove(ctx, "leads:filter:version")
}
