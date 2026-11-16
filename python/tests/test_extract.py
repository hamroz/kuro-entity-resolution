from conftest import find


def test_every_mention_points_back_to_its_source(docs, mentions):
    text = {d["id"]: d["text"] for d in docs}
    for m in mentions:
        t = text[m["doc_id"]]
        assert t[m["start"]:m["end"]] == m["surface"]
        assert t.split("\n")[m["line"] - 1].find(m["surface"]) >= 0


def test_messy_variants_are_found(mentions):
    surfaces = {m["surface"] for m in mentions if m["type"] == "org"}
    for s in ["Müller Bau GmbH", "Mueller-Bau", "Müller Bauunternehmung GmbH", "M. Bau GmbH & Co. KG",
              "Müller Bau", "Elektro Schmidt GmbH", "Schmidt Elektro", "Elbtal Fassaden", "MB Rohbau Berlin"]:
        assert s in surfaces, s


def test_identifiers_and_context(mentions):
    footer = find(mentions, "d03", "Müller Bau GmbH", 2)
    assert footer["ctx"]["vat"] == "DE287445190"
    assert footer["ctx"]["register"] == "HRB 145233"
    assert footer["ctx"]["city"] == "Berlin"
    issuer = find(mentions, "d03", "Müller Bau GmbH", 1)
    assert issuer["ctx"]["vendor"] == "4711" and issuer["ctx"]["trade"] == "Rohbau"
    mb = find(mentions, "d05", "MB Rohbau Berlin")
    assert mb["ctx"]["vat"] == "DE287445190"  # spaced "DE 287 445 190" normalised
    assert mb["ctx"]["street"] == find(mentions, "d01", "Müller Bauunternehmung GmbH")["ctx"]["street"]


def test_letterhead_alias(mentions):
    trade_name = find(mentions, "d08", "Elbtal Fassaden")
    legal = find(mentions, "d08", "Kühn Fassadentechnik GmbH")
    assert trade_name["ctx"]["alias_of"] == legal["id"]
    assert trade_name["ctx"]["city"] == "Dresden"


def test_person_employer(mentions):
    p = find(mentions, "d04", "T. Becker")
    assert p["ctx"]["org_surface"] == "Brandt Generalbau"
    # a person in the same timeline paragraph as other firms gets no employer guessed
    assert find(mentions, "d04", "Hr. Schmidt")["ctx"]["org_mention_id"] is None
