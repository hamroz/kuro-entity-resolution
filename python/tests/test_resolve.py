from conftest import find, pair_of

from resolver import reconcile, current_clusters


def test_string_similarity_alone_is_not_sure(mentions, pairs):
    # "Müller Bau" with no context vs the Berlin firm: same name, but nothing else
    p = pair_of(pairs, find(mentions, "d02", "Müller Bau"), find(mentions, "d03", "Müller Bau GmbH"))
    assert p["bucket"] == "unsure" and p["rule"] == "R3"


def test_same_name_different_firm_is_kept_apart(mentions, pairs):
    berlin = find(mentions, "d03", "Müller Bau GmbH", 2)
    hamburg = find(mentions, "d09", "Müller Bau GmbH", 0)
    p = pair_of(pairs, berlin, hamburg)
    assert p["name_sim"] == 1.0
    assert p["bucket"] == "separate" and p["rule"] == "R0"
    assert any(e["code"] == "vat_conflict" for e in p["evidence"])


def test_vendor_number_links_a_different_name(mentions, pairs):
    p = pair_of(pairs, find(mentions, "d03", "Müller Bau GmbH", 1), find(mentions, "d05", "MB Rohbau Berlin"))
    assert p["name_sim"] < 0.5
    assert p["bucket"] == "auto" and p["rule"] == "R1"
    assert any(e["code"] == "vendor_match" for e in p["evidence"])


def test_two_schmidt_elektro_in_two_cities(mentions, pairs):
    p = pair_of(pairs, find(mentions, "d02", "Schmidt Elektro GmbH", 2), find(mentions, "d06", "Schmidt Elektrotechnik GmbH"))
    assert p["bucket"] == "separate" and p["rule"] == "R0"
    # the diary entry without a city follows the project context to Leipzig
    diary = find(mentions, "d07", "Schmidt Elektro")
    leipzig = pair_of(pairs, find(mentions, "d06", "Schmidt Elektrotechnik GmbH"), diary)
    assert leipzig["bucket"] == "auto"


def test_trade_name_joins_legal_name(mentions, pairs):
    p = pair_of(pairs, find(mentions, "d08", "Elbtal Fassaden"), find(mentions, "d08", "Kühn Fassadentechnik GmbH"))
    assert p["bucket"] == "auto" and p["rule"] == "R1"


def test_abbreviation_is_a_question_not_an_answer(mentions, pairs):
    p = pair_of(pairs, find(mentions, "d04", "Mueller-Bau"), find(mentions, "d06", "M. Bau GmbH & Co. KG"))
    assert p["bucket"] == "unsure"


def test_every_decision_explains_itself(pairs):
    for p in pairs:
        assert p["rule"] in {"R0", "R1", "R2", "R3", "R4"}
        assert 0.0 <= p["confidence"] <= 1.0
        if p["bucket"] != "separate" or p["rule"] == "R0":
            assert p["evidence"] or p["name_sim"] > 0


def test_clusters_on_samples(mentions, pairs):
    events = reconcile(pairs, [], "t0")
    roots, blocked, _ = current_clusters([m["id"] for m in mentions], pairs, events)
    def root(doc, s, n=0):
        return roots[find(mentions, doc, s, n)["id"]]
    berlin = root("d03", "Müller Bau GmbH")
    assert root("d01", "Müller Bauunternehmung GmbH") == berlin
    assert root("d04", "Mueller-Bau") == berlin
    assert root("d05", "MB Rohbau Berlin") == berlin
    assert root("d09", "Müller Bau GmbH", 1) == berlin       # "our framework partner ... from Berlin"
    assert root("d09", "Müller Bau GmbH", 0) != berlin       # the Hamburg firm
    assert root("d09", "Müller Bau GmbH", 2) == root("d09", "Müller Bau GmbH", 0)
    assert root("d02", "Schmidt Elektro GmbH") != root("d06", "Schmidt Elektrotechnik GmbH")
    # persons: employer resolution makes "S. Wolff" at "MB Rohbau Berlin" the same Sabine Wolff
    assert root("d05", "S. Wolff") == root("d01", "Sabine Wolff")
