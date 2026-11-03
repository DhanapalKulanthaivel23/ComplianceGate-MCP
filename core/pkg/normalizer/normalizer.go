// Package normalizer provides deterministic text normalization, phonetic encoding, and string distance metrics.
package normalizer

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

var (
	whitespaceRegex = regexp.MustCompile(`\s+`)
	latinLetterRegex = regexp.MustCompile(`[a-zA-Z]`)
)

// NormalizeEntityName cleans strings:
// 1. NFKC case folding
// 2. Maps Cyrillic homoglyphs to Latin when text contains Latin letters (mixed-script homoglyph evasion)
// 3. Decomposes & flattens Latin diacritics while preserving Arabic, CJK, and Cyrillic scripts
// 4. Collapses single-letter spaced fragmentation ("o c e a n i c")
// 5. Collapses whitespace
func NormalizeEntityName(input string) string {
	if input == "" {
		return ""
	}

	text := strings.TrimSpace(input)

	// Step 1: Mixed-script Cyrillic homoglyph substitution
	if latinLetterRegex.MatchString(text) {
		text = replaceCyrillicHomoglyphs(text)
	}

	// Step 2: Flatten Latin accents while preserving non-Latin scripts
	var b strings.Builder
	for _, r := range text {
		if r >= 0x00C0 && r <= 0x024F {
			b.WriteRune(flattenLatinDiacritic(r))
		} else {
			b.WriteRune(r)
		}
	}
	text = b.String()

	// Step 3: Lowercase
	text = strings.ToLower(text)

	// Step 4: Keep unicode letters, numbers, and spaces; strip punctuation
	var clean strings.Builder
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsSpace(r) {
			clean.WriteRune(r)
		} else {
			clean.WriteRune(' ')
		}
	}
	text = clean.String()

	// Step 5: Collapse single-letter fragmentation (e.g. "o c e a n i c" -> "oceanic")
	text = collapseSpacedLetters(text)

	// Step 6: Collapse whitespace
	text = whitespaceRegex.ReplaceAllString(text, " ")
	return strings.TrimSpace(text)
}

func replaceCyrillicHomoglyphs(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '\u0430', '\u0410': // Cyrillic a/A
			b.WriteRune('a')
		case '\u0435', '\u0415': // Cyrillic e/E
			b.WriteRune('e')
		case '\u043E', '\u041E': // Cyrillic o/O
			b.WriteRune('o')
		case '\u0440', '\u0420': // Cyrillic p/P
			b.WriteRune('p')
		case '\u0441', '\u0421': // Cyrillic c/C
			b.WriteRune('c')
		case '\u0443', '\u0423': // Cyrillic y/Y
			b.WriteRune('y')
		case '\u0445', '\u0425': // Cyrillic x/X
			b.WriteRune('x')
		case '\u0456', '\u0406': // Cyrillic i/I
			b.WriteRune('i')
		case '\u0458', '\u0408': // Cyrillic j/J
			b.WriteRune('j')
		case '\u0455', '\u0405': // Cyrillic s/S
			b.WriteRune('s')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func flattenLatinDiacritic(r rune) rune {
	switch r {
	case 'ä', 'á', 'à', 'â', 'ã', 'å', 'Ä', 'Á', 'À', 'Â', 'Ã', 'Å', 'æ', 'Æ':
		return 'a'
	case 'ë', 'é', 'è', 'ê', 'Ë', 'É', 'È', 'Ê':
		return 'e'
	case 'ï', 'í', 'ì', 'î', 'Ï', 'Í', 'Ì', 'Î':
		return 'i'
	case 'ö', 'ó', 'ò', 'ô', 'õ', 'ø', 'Ö', 'Ó', 'Ò', 'Ô', 'Õ', 'Ø':
		return 'o'
	case 'ü', 'ú', 'ù', 'û', 'Ü', 'Ú', 'Ù', 'Û':
		return 'u'
	case 'ç', 'Ç':
		return 'c'
	case 'ñ', 'Ñ':
		return 'n'
	case 'ß':
		return 's'
	default:
		return r
	}
}

func collapseSpacedLetters(s string) string {
	parts := strings.Fields(s)
	if len(parts) < 2 {
		return s
	}

	var result []string
	var buffer strings.Builder

	for _, p := range parts {
		if len(p) == 1 {
			buffer.WriteString(p)
		} else {
			if buffer.Len() > 0 {
				result = append(result, buffer.String())
				buffer.Reset()
			}
			result = append(result, p)
		}
	}
	if buffer.Len() > 0 {
		result = append(result, buffer.String())
	}
	return strings.Join(result, " ")
}

// NormalizeIdentifier strips whitespace, punctuation, and standardizes formats (BIC, LEI, IMO, ISIN).
func NormalizeIdentifier(idType, val string) string {
	val = strings.ToUpper(strings.TrimSpace(val))
	val = regexp.MustCompile(`[\s\-_./\\:]`).ReplaceAllString(val, "")
	if idType == "IMO" && strings.HasPrefix(val, "IMO") {
		return strings.TrimPrefix(val, "IMO")
	}
	return val
}

// LevenshteinDistance computes edit distance between two strings.
func LevenshteinDistance(s1, s2 string) int {
	r1, r2 := []rune(s1), []rune(s2)
	l1, l2 := len(r1), len(r2)

	if l1 == 0 {
		return l2
	}
	if l2 == 0 {
		return l1
	}

	v0 := make([]int, l2+1)
	v1 := make([]int, l2+1)

	for i := 0; i <= l2; i++ {
		v0[i] = i
	}

	for i := 0; i < l1; i++ {
		v1[0] = i + 1
		for j := 0; j < l2; j++ {
			cost := 0
			if r1[i] != r2[j] {
				cost = 1
			}
			v1[j+1] = min3(v1[j]+1, v0[j+1]+1, v0[j]+cost)
		}
		copy(v0, v1)
	}

	return v1[l2]
}

func min3(a, b, c int) int {
	if a < b {
		if a < c {
			return a
		}
		return c
	}
	if b < c {
		return b
	}
	return c
}

// JaroWinkler computes Jaro-Winkler similarity (0.0 to 1.0).
func JaroWinkler(s1, s2 string) float64 {
	if s1 == s2 {
		return 1.0
	}
	if s1 == "" || s2 == "" {
		return 0.0
	}

	r1, r2 := []rune(s1), []rune(s2)
	l1, l2 := len(r1), len(r2)
	matchDist := int(math.Floor(math.Max(float64(l1), float64(l2))/2.0)) - 1

	s1Matches := make([]bool, l1)
	s2Matches := make([]bool, l2)
	matches := 0

	for i := 0; i < l1; i++ {
		start := int(math.Max(0, float64(i-matchDist)))
		end := int(math.Min(float64(i+matchDist+1), float64(l2)))

		for j := start; j < end; j++ {
			if !s2Matches[j] && r1[i] == r2[j] {
				s1Matches[i] = true
				s2Matches[j] = true
				matches++
				break
			}
		}
	}

	if matches == 0 {
		return 0.0
	}

	transpositions := 0
	k := 0
	for i := 0; i < l1; i++ {
		if s1Matches[i] {
			for !s2Matches[k] {
				k++
			}
			if r1[i] != r2[k] {
				transpositions++
			}
			k++
		}
	}

	m := float64(matches)
	jaro := (m/float64(l1) + m/float64(l2) + (m-float64(transpositions)/2.0)/m) / 3.0

	// Prefix scale
	prefix := 0
	maxPrefix := int(math.Min(4, math.Min(float64(l1), float64(l2))))
	for i := 0; i < maxPrefix; i++ {
		if r1[i] == r2[i] {
			prefix++
		} else {
			break
		}
	}

	return math.Min(1.0, jaro+float64(prefix)*0.1*(1.0-jaro))
}

// TokenSortRatio computes token-order invariant similarity.
func TokenSortRatio(str1, str2 string) float64 {
	n1 := NormalizeEntityName(str1)
	n2 := NormalizeEntityName(str2)
	if n1 == "" || n2 == "" {
		return 0.0
	}
	if n1 == n2 {
		return 1.0
	}

	t1 := strings.Fields(n1)
	t2 := strings.Fields(n2)
	sort.Strings(t1)
	sort.Strings(t2)

	sorted1 := strings.Join(t1, " ")
	sorted2 := strings.Join(t2, " ")
	if sorted1 == sorted2 {
		return 1.0
	}

	maxLen := math.Max(float64(len([]rune(sorted1))), float64(len([]rune(sorted2))))
	if maxLen == 0 {
		return 1.0
	}

	dist := float64(LevenshteinDistance(sorted1, sorted2))
	levRatio := 1.0 - (dist / maxLen)
	jwRatio := JaroWinkler(sorted1, sorted2)

	return math.Max(0.0, math.Min(1.0, levRatio*0.4+jwRatio*0.6))
}

// TokenSetRatio computes intersection token similarity, identifying sanctioned names in noisy narratives.
func TokenSetRatio(str1, str2 string) float64 {
	n1 := NormalizeEntityName(str1)
	n2 := NormalizeEntityName(str2)
	if n1 == "" || n2 == "" {
		return 0.0
	}
	if n1 == n2 {
		return 1.0
	}

	tokens1 := strings.Fields(n1)
	tokens2 := strings.Fields(n2)

	set1 := make(map[string]bool)
	set2 := make(map[string]bool)
	for _, t := range tokens1 {
		set1[t] = true
	}
	for _, t := range tokens2 {
		set2[t] = true
	}

	minLen := len(set1)
	smallerSet := set1
	largerSet := set2
	if len(set2) < minLen {
		minLen = len(set2)
		smallerSet = set2
		largerSet = set1
	}

	matches := 0
	for t := range smallerSet {
		if largerSet[t] {
			matches++
		}
	}

	fraction := float64(matches) / float64(minLen)
	if fraction == 1.0 && minLen >= 2 {
		return 0.95 // High confidence full entity containment in narrative
	}
	if fraction >= 0.75 && minLen >= 3 {
		return 0.85
	}

	return TokenSortRatio(str1, str2)
}

// Soundex computes American Soundex code for phonetic matching.
func Soundex(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	if s == "" {
		return ""
	}

	runes := []rune(s)
	var firstRune rune
	for _, r := range runes {
		if unicode.IsLetter(r) {
			firstRune = r
			break
		}
	}
	if firstRune == 0 {
		return ""
	}

	codeMap := map[rune]rune{
		'B': '1', 'F': '1', 'P': '1', 'V': '1',
		'C': '2', 'G': '2', 'J': '2', 'K': '2', 'Q': '2', 'S': '2', 'X': '2', 'Z': '2',
		'D': '3', 'T': '3',
		'L': '4',
		'M': '5', 'N': '5',
		'R': '6',
	}

	var code strings.Builder
	code.WriteRune(firstRune)

	prev := codeMap[firstRune]
	for _, r := range runes[1:] {
		if !unicode.IsLetter(r) {
			continue
		}
		c := codeMap[r]
		if c != 0 && c != prev {
			code.WriteRune(c)
			prev = c
		} else if c == 0 {
			prev = 0
		}
		if code.Len() == 4 {
			break
		}
	}

	for code.Len() < 4 {
		code.WriteRune('0')
	}

	return code.String()
}
