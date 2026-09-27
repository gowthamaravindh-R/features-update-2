# ============================================
# Automated Test Suite for Verity AI Verification Logic
# Tests the 8 core verification scenarios:
# 1. Pure Support (No 95% cap -> 100%)
# 2. Pure Contradict (Refuted -> 0% support)
# 3. Insufficient Evidence (0 support, 0 contradict -> None / N/A, never 50%)
# 4. Non-decisive evidence does NOT act as contradiction (1 support + 2 no_decisive -> 100%)
# 5. Mixed Support & Contradict (Deterministic formula calculation)
# 6. Configured Source Weights (Gov=0.85, Wiki=0.75, Web=0.50, Forum=0.25)
# 7. Executive Summary Aggregation (VERIFIED, CONTRADICTIONS_DETECTED, MIXED, INSUFFICIENT)
# 8. Mathematical Consistency (Formula text matches exact numbers)
# ============================================

import re
from urllib.parse import urlparse

SOURCE_TYPE_WEIGHTS = {
    'authoritative': 0.85,
    'wikipedia': 0.75,
    'web_general': 0.50,
    'low_authority': 0.25,
    'default': 0.50
}

def extract_domain(url=''):
    try:
        if not url.startswith('http'):
            return url
        netloc = urlparse(url).netloc
        return re.sub(r'^www\.', '', netloc)
    except Exception:
        return 'web'

def get_source_weight(url='', source_type=''):
    u = (url or '').lower()
    st = (source_type or '').lower()
    domain = extract_domain(url)

    if 'wikipedia' in st or 'wiki' in st or 'wikipedia.org' in u:
        return {
            'weight': SOURCE_TYPE_WEIGHTS['wikipedia'],
            'category': 'wikipedia',
            'label': 'Reference (Wikipedia)',
            'domain': 'en.wikipedia.org'
        }

    if any(f in u for f in ['quora.com', 'brainly.com', 'reddit.com', 'facebook.com']):
        return {
            'weight': SOURCE_TYPE_WEIGHTS['low_authority'],
            'category': 'low_authority',
            'label': 'Community Forum / UGC',
            'domain': domain or 'forum'
        }

    if any(auth in u for auth in ['.gov', '.edu', 'nasa.gov', 'nih.gov', 'nature.com', 'reuters.com', 'who.int']):
        return {
            'weight': SOURCE_TYPE_WEIGHTS['authoritative'],
            'category': 'authoritative',
            'label': 'Authoritative / Academic',
            'domain': domain or 'official'
        }

    return {
        'weight': SOURCE_TYPE_WEIGHTS['web_general'],
        'category': 'web_general',
        'label': 'Standard Web Source',
        'domain': domain or 'web'
    }

def aggregate_evidence(sources_with_nli):
    weighted_support = 0.0
    weighted_contradict = 0.0
    weighted_no_decisive = 0.0
    support_count = 0
    contradict_count = 0
    no_decisive_count = 0

    for s in sources_with_nli:
        w = s.get('source_weight', s.get('reliability', 0.50)) * s.get('relevance', 0.50)
        rel = s.get('nliRelationship')
        if rel == 'SUPPORT':
            weighted_support += w
            support_count += 1
        elif rel == 'CONTRADICT':
            weighted_contradict += w
            contradict_count += 1
        else:
            weighted_no_decisive += w
            no_decisive_count += 1

    total_decisive_signal = weighted_support + weighted_contradict

    if support_count == 0 and contradict_count == 0:
        return {
            'evidenceConfidence': None,
            'verdict': 'UNVERIFIABLE',
            'status': 'Insufficient evidence',
            'corroborationRate': None,
            'weightedSupport': 0.0,
            'weightedContradict': 0.0,
            'weightedNeutral': round(weighted_no_decisive, 3),
            'weightedNoDecisive': round(weighted_no_decisive, 3),
            'supportCount': 0,
            'contradictCount': 0,
            'neutralCount': no_decisive_count,
            'noDecisiveCount': no_decisive_count,
            'formula': 'Undefined (Support = 0, Contradict = 0)',
            'reason': 'No decisive supporting or contradicting evidence found in retrieved sources. Evidence Confidence is N/A.'
        }

    raw_ratio = weighted_support / total_decisive_signal
    evidence_confidence = round(raw_ratio * 100)

    if evidence_confidence >= 60:
        verdict = 'SUPPORTED'
        status = 'Evidence supports claim'
    elif evidence_confidence <= 40:
        verdict = 'REFUTED'
        status = 'Evidence contradicts claim'
    else:
        verdict = 'UNCERTAIN'
        status = 'Conflicting evidence'

    return {
        'evidenceConfidence': evidence_confidence,
        'verdict': verdict,
        'status': status,
        'corroborationRate': evidence_confidence,
        'weightedSupport': round(weighted_support, 3),
        'weightedContradict': round(weighted_contradict, 3),
        'weightedNeutral': round(weighted_no_decisive, 3),
        'weightedNoDecisive': round(weighted_no_decisive, 3),
        'supportCount': support_count,
        'contradictCount': contradict_count,
        'neutralCount': no_decisive_count,
        'noDecisiveCount': no_decisive_count,
        'formula': f"Support [{weighted_support:.3f}] / (Support [{weighted_support:.3f}] + Contradict [{weighted_contradict:.3f}])",
        'reason': f"Formula: {weighted_support:.3f} / ({weighted_support:.3f} + {weighted_contradict:.3f}) = {evidence_confidence}%"
    }

def calculate_executive_summary(sentences):
    if not sentences:
        return {
            'statusKey': 'INSUFFICIENT_EVIDENCE',
            'statusLabel': 'Insufficient Evidence',
            'badgeType': 'neutral',
            'summaryText': 'No verifiable claims were evaluated.',
            'totalClaims': 0,
            'supportedClaims': 0,
            'refutedClaims': 0,
            'uncertainClaims': 0,
            'unverifiableClaims': 0,
            'decisiveClaims': 0,
            'corroborationRate': None
        }

    total = len(sentences)
    supported = sum(1 for s in sentences if s.get('verdict') == 'SUPPORTED')
    refuted = sum(1 for s in sentences if s.get('verdict') == 'REFUTED')
    uncertain = sum(1 for s in sentences if s.get('verdict') == 'UNCERTAIN')
    unverifiable = sum(1 for s in sentences if s.get('verdict') == 'UNVERIFIABLE')
    decisive = supported + refuted
    corroboration_rate = round((supported / decisive) * 100) if decisive > 0 else None

    if refuted > 0:
        status_key = 'CONTRADICTIONS_DETECTED'
        status_label = 'Contradictions Detected'
        badge_type = 'danger'
        summary_text = f"{refuted} of {total} claim(s) contradicted by retrieved evidence. {supported} verified."
    elif unverifiable == total:
        status_key = 'INSUFFICIENT_EVIDENCE'
        status_label = 'Insufficient Evidence'
        badge_type = 'neutral'
        summary_text = f"No decisive evidence found across retrieved sources to verify or refute these {total} claim(s)."
    elif supported == total:
        status_key = 'VERIFIED'
        status_label = 'Verified by Evidence'
        badge_type = 'success'
        summary_text = f"All {total} claim(s) verified and supported by authoritative reference evidence."
    else:
        status_key = 'MIXED'
        status_label = 'Mixed Evidence'
        badge_type = 'warning'
        summary_text = f"{supported} of {total} claim(s) supported, {uncertain} uncertain, and {unverifiable} unverifiable."

    return {
        'statusKey': status_key,
        'statusLabel': status_label,
        'badgeType': badge_type,
        'summaryText': summary_text,
        'totalClaims': total,
        'supportedClaims': supported,
        'refutedClaims': refuted,
        'uncertainClaims': uncertain,
        'unverifiableClaims': unverifiable,
        'decisiveClaims': decisive,
        'corroborationRate': corroboration_rate
    }

print("[START] Verity AI Verification Logic Test Suite (Python Engine)...\n")

passed = 0

# Test 1
s1 = [
    {'source_weight': 0.75, 'relevance': 0.8, 'nliRelationship': 'SUPPORT'},
    {'source_weight': 0.50, 'relevance': 0.6, 'nliRelationship': 'SUPPORT'}
]
res1 = aggregate_evidence(s1)
assert res1['verdict'] == 'SUPPORTED'
assert res1['evidenceConfidence'] == 100, f"Expected 100, got {res1['evidenceConfidence']}"
assert res1['supportCount'] == 2
assert res1['contradictCount'] == 0
print("[PASS] Test 1: Pure Support produces exactly 100% confidence (No artificial 95% cap).")
passed += 1

# Test 2
s2 = [
    {'source_weight': 0.85, 'relevance': 0.9, 'nliRelationship': 'CONTRADICT'},
    {'source_weight': 0.50, 'relevance': 0.7, 'nliRelationship': 'CONTRADICT'}
]
res2 = aggregate_evidence(s2)
assert res2['verdict'] == 'REFUTED'
assert res2['evidenceConfidence'] == 0
assert res2['contradictCount'] == 2
assert res2['supportCount'] == 0
print("[PASS] Test 2: Pure Contradiction produces REFUTED verdict with 0% support.")
passed += 1

# Test 3
s3 = [
    {'source_weight': 0.75, 'relevance': 0.4, 'nliRelationship': 'NO_DECISIVE_EVIDENCE'},
    {'source_weight': 0.50, 'relevance': 0.3, 'nliRelationship': 'NO_DECISIVE_EVIDENCE'}
]
res3 = aggregate_evidence(s3)
assert res3['verdict'] == 'UNVERIFIABLE'
assert res3['evidenceConfidence'] is None, f"Expected None, got {res3['evidenceConfidence']}"
assert res3['supportCount'] == 0
assert res3['contradictCount'] == 0
assert res3['noDecisiveCount'] == 2
print("[PASS] Test 3: Zero decisive signals returns UNVERIFIABLE with null/None confidence (NO 50% fallback).")
passed += 1

# Test 4
s4 = [
    {'source_weight': 0.75, 'relevance': 0.8, 'nliRelationship': 'SUPPORT'},
    {'source_weight': 0.50, 'relevance': 0.5, 'nliRelationship': 'NO_DECISIVE_EVIDENCE'},
    {'source_weight': 0.25, 'relevance': 0.4, 'nliRelationship': 'NO_DECISIVE_EVIDENCE'}
]
res4 = aggregate_evidence(s4)
assert res4['verdict'] == 'SUPPORTED'
assert res4['evidenceConfidence'] == 100, f"Expected 100, got {res4['evidenceConfidence']}"
assert res4['supportCount'] == 1
assert res4['noDecisiveCount'] == 2
print("[PASS] Test 4: Non-decisive evidence does not penalize claims.")
passed += 1

# Test 5
s5 = [
    {'source_weight': 0.75, 'relevance': 0.8, 'nliRelationship': 'SUPPORT'},
    {'source_weight': 0.50, 'relevance': 0.6, 'nliRelationship': 'CONTRADICT'}
]
res5 = aggregate_evidence(s5)
assert res5['verdict'] == 'SUPPORTED'
assert res5['evidenceConfidence'] == 67
assert res5['weightedSupport'] == 0.600
assert res5['weightedContradict'] == 0.300
print("[PASS] Test 5: Deterministic mixed signal calculation 0.600/(0.600+0.300) = 67%.")
passed += 1

# Test 6
w_gov = get_source_weight('https://science.nasa.gov/mission/webb', 'web')
w_wiki = get_source_weight('https://en.wikipedia.org/wiki/Jupiter', 'wikipedia')
w_general = get_source_weight('https://example.com/article', 'web')
w_forum = get_source_weight('https://quora.com/question/123', 'web')

assert w_gov['weight'] == 0.85
assert w_wiki['weight'] == 0.75
assert w_general['weight'] == 0.50
assert w_forum['weight'] == 0.25
print("[PASS] Test 6: Configured source weights match architectural specifications.")
passed += 1

# Test 7
exec_a = calculate_executive_summary([
    {'verdict': 'SUPPORTED'},
    {'verdict': 'REFUTED'},
    {'verdict': 'SUPPORTED'}
])
assert exec_a['statusKey'] == 'CONTRADICTIONS_DETECTED'
assert exec_a['corroborationRate'] == 67

exec_b = calculate_executive_summary([
    {'verdict': 'SUPPORTED'},
    {'verdict': 'SUPPORTED'}
])
assert exec_b['statusKey'] == 'VERIFIED'
assert exec_b['corroborationRate'] == 100

exec_c = calculate_executive_summary([
    {'verdict': 'UNVERIFIABLE'},
    {'verdict': 'UNVERIFIABLE'}
])
assert exec_c['statusKey'] == 'INSUFFICIENT_EVIDENCE'
assert exec_c['corroborationRate'] is None
print("[PASS] Test 7: Executive summary accurately reflects overall status and corroboration rate.")
passed += 1

# Test 8
s8 = [
    {'source_weight': 0.85, 'relevance': 1.0, 'nliRelationship': 'SUPPORT'},
    {'source_weight': 0.25, 'relevance': 0.5, 'nliRelationship': 'CONTRADICT'}
]
res8 = aggregate_evidence(s8)
assert res8['evidenceConfidence'] == 87
assert res8['weightedSupport'] == 0.850
assert res8['weightedContradict'] == 0.125
assert res8['reason'] == 'Formula: 0.850 / (0.850 + 0.125) = 87%'
print("[PASS] Test 8: Displayed formula string matches computed software values identically.")
passed += 1

print(f"\n[SUMMARY] ALL {passed}/8 VERIFICATION TESTS PASSED SUCCESSFULLY!")
