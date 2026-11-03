// Package engine provides high-throughput in-memory screening, indexing, and deterministic alert generation.
package engine

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/compliancegate/compliancegate-core/pkg/lists"
	"github.com/compliancegate/compliancegate-core/pkg/model"
	"github.com/compliancegate/compliancegate-core/pkg/normalizer"
)

type ScreeningEngine struct {
	repo           *lists.WatchlistRepository
	defaultCutoff  float64
}

func NewScreeningEngine(repo *lists.WatchlistRepository) *ScreeningEngine {
	return &ScreeningEngine{
		repo:          repo,
		defaultCutoff: 0.80,
	}
}

// ScreenEntity evaluates a single canonical ScreenableEntity against the active in-memory watchlist.
func (e *ScreeningEngine) ScreenEntity(entity model.ScreenableEntity, cutoff float64) model.ScreeningResult {
	start := time.Now()
	if cutoff <= 0 {
		cutoff = e.defaultCutoff
	}

	normQueryName := normalizer.NormalizeEntityName(entity.Name)
	querySoundex := normalizer.Soundex(entity.Name)

	var matches []model.MatchDetail
	entries := e.repo.GetAllEntries()

	for _, entry := range entries {
		// 1. Exact Identifier Matching
		for _, qId := range entity.Identifiers {
			for _, eId := range entry.Identifiers {
				if normalizer.NormalizeIdentifier(qId.Type, qId.Value) == normalizer.NormalizeIdentifier(eId.Type, eId.Value) && qId.Value != "" {
					matches = append(matches, model.MatchDetail{
						ListID:          entry.ListID,
						ListName:        entry.ListName,
						EntryID:         entry.ID,
						EntryName:       entry.Name,
						EntryType:       entry.EntityType,
						MatchType:       model.MatchExactIdentifier,
						MatchedField:    qId.Type,
						QueryValue:      qId.Value,
						ListValue:       eId.Value,
						SimilarityScore: 1.0,
						Programs:        entry.Programs,
						Notes:           fmt.Sprintf("Exact candidate correlation on %s identifier [%s]", qId.Type, qId.Value),
					})
				}
			}
		}

		// 2. Name & Alias Matching
		if len(normQueryName) >= 3 {
			entryNormName := normalizer.NormalizeEntityName(entry.Name)
			nameScore := math.Max(
				normalizer.TokenSortRatio(normQueryName, entryNormName),
				normalizer.TokenSetRatio(normQueryName, entryNormName),
			)

			// Phonetic boost if Soundex matches
			entrySoundex := normalizer.Soundex(entry.Name)
			if querySoundex != "" && querySoundex == entrySoundex && nameScore >= 0.70 {
				nameScore = math.Max(nameScore, 0.85)
			}

			if nameScore >= cutoff {
				matchType := model.MatchFuzzyName
				if nameScore >= 0.99 {
					matchType = model.MatchExactName
				} else if querySoundex == entrySoundex {
					matchType = model.MatchPhonetic
				}

				matches = append(matches, model.MatchDetail{
					ListID:          entry.ListID,
					ListName:        entry.ListName,
					EntryID:         entry.ID,
					EntryName:       entry.Name,
					EntryType:       entry.EntityType,
					MatchType:       matchType,
					MatchedField:    "name",
					QueryValue:      entity.Name,
					ListValue:       entry.Name,
					SimilarityScore: math.Round(nameScore*10000) / 10000,
					Programs:        entry.Programs,
					Notes:           fmt.Sprintf("Token/phonetic similarity score %.4f. Requires human analyst adjudication.", nameScore),
				})
			}

			// Check aliases
			for _, alias := range entry.Aliases {
				aliasNorm := normalizer.NormalizeEntityName(alias)
				aliasScore := math.Max(
					normalizer.TokenSortRatio(normQueryName, aliasNorm),
					normalizer.TokenSetRatio(normQueryName, aliasNorm),
				)
				if aliasScore >= cutoff {
					matches = append(matches, model.MatchDetail{
						ListID:          entry.ListID,
						ListName:        entry.ListName,
						EntryID:         entry.ID,
						EntryName:       entry.Name,
						EntryType:       entry.EntityType,
						MatchType:       model.MatchAlias,
						MatchedField:    "alias",
						QueryValue:      entity.Name,
						ListValue:       alias,
						SimilarityScore: math.Round(aliasScore*10000) / 10000,
						Programs:        entry.Programs,
						Notes:           fmt.Sprintf("Alias candidate match score %.4f on [%s]", aliasScore, alias),
					})
				}
			}
		}
	}

	// Sort matches: Exact identifiers first, then highest similarity score
	sort.Slice(matches, func(i, j int) bool {
		if matches[i].MatchType == model.MatchExactIdentifier && matches[j].MatchType != model.MatchExactIdentifier {
			return true
		}
		if matches[i].MatchType != model.MatchExactIdentifier && matches[j].MatchType == model.MatchExactIdentifier {
			return false
		}
		return matches[i].SimilarityScore > matches[j].SimilarityScore
	})

	hasExactId := false
	highestScore := 0.0
	for _, m := range matches {
		if m.MatchType == model.MatchExactIdentifier {
			hasExactId = true
		}
		if m.SimilarityScore > highestScore {
			highestScore = m.SimilarityScore
		}
	}

	severity := model.SeverityNoMatchFound
	if hasExactId {
		severity = model.SeverityExactIdentifierMatch
	} else if len(matches) > 0 && highestScore >= cutoff {
		severity = model.SeverityFuzzyNameCandidate
	}

	res := model.ScreeningResult{
		EntityID:             entity.ID,
		FindingSeverity:      severity,
		HighestScore:         highestScore,
		Matches:              matches,
		EvaluationDurationMs: float64(time.Since(start).Microseconds()) / 1000.0,
	}
	res.EvidenceDigest = model.ComputeEvidenceDigest(res)

	return res
}

// ScreenMessage evaluates a batch of ScreenableEntities extracted from a message and computes disposition.
func (e *ScreeningEngine) ScreenMessage(format, subType string, entities []model.ScreenableEntity, cutoff float64) model.MessageScreeningResult {
	var results []model.ScreeningResult
	disposition := "AUTO_RELEASE"

	for _, ent := range entities {
		r := e.ScreenEntity(ent, cutoff)
		results = append(results, r)
		if r.FindingSeverity == model.SeverityExactIdentifierMatch {
			disposition = "BLOCKED"
		} else if r.FindingSeverity == model.SeverityFuzzyNameCandidate && disposition != "BLOCKED" {
			disposition = "MANUAL_REVIEW_REQUIRED"
		}
	}

	if len(entities) == 0 || !model.IsVerifiedTestedProfile(subType, true) {
		if disposition == "AUTO_RELEASE" {
			disposition = "MANUAL_REVIEW_REQUIRED"
		}
	}

	msgRes := model.MessageScreeningResult{
		Format:            format,
		SubType:           subType,
		EntitiesExtracted: len(entities),
		Entities:          entities,
		EntityResults:     results,
		Disposition:       disposition,
	}
	msgRes.EvidenceDigest = model.ComputeEvidenceDigest(msgRes)
	return msgRes
}

// ExplainMatch provides detailed diagnostic reasoning for a match candidate.
func (e *ScreeningEngine) ExplainMatch(queryName, listName string) map[string]interface{} {
	norm1 := normalizer.NormalizeEntityName(queryName)
	norm2 := normalizer.NormalizeEntityName(listName)
	tokens1 := strings.Fields(norm1)
	tokens2 := strings.Fields(norm2)

	levDist := normalizer.LevenshteinDistance(norm1, norm2)
	jwScore := normalizer.JaroWinkler(norm1, norm2)
	tokenSort := normalizer.TokenSortRatio(queryName, listName)
	tokenSet := normalizer.TokenSetRatio(queryName, listName)
	soundex1 := normalizer.Soundex(queryName)
	soundex2 := normalizer.Soundex(listName)

	return map[string]interface{}{
		"queryNormalized":     norm1,
		"targetNormalized":    norm2,
		"queryTokens":         tokens1,
		"targetTokens":        tokens2,
		"levenshteinDistance": levDist,
		"jaroWinkler":         jwScore,
		"tokenSortRatio":      tokenSort,
		"tokenSetRatio":       tokenSet,
		"querySoundex":        soundex1,
		"targetSoundex":       soundex2,
		"isPhoneticMatch":     soundex1 == soundex2 && soundex1 != "",
		"explanation": fmt.Sprintf(
			"Normalized query '%s' vs list '%s'. Token Sort: %.2f%%, Token Set: %.2f%%, Phonetic Soundex: [%s vs %s].",
			norm1, norm2, tokenSort*100, tokenSet*100, soundex1, soundex2,
		),
	}
}
