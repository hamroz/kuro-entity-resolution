from resolver.normalize import fold, name_similarity, org_core, person_name_similarity, person_parts


def test_umlaut_folding():
    assert fold("Müller Straße") == "mueller strasse"
    assert fold("Mueller") == fold("Müller")


def test_legal_forms_are_stripped_and_recorded():
    c = org_core("M. Bau GmbH & Co. KG")
    assert c["tokens"] == ["m", "bau"]
    assert c["legal_form"] == "GmbH & Co. KG"
    assert org_core("Hanseatische Hochbau AG")["legal_form"] == "AG"
    assert org_core("Mueller-Bau")["legal_form"] is None


def test_variants_share_a_core():
    cores = {org_core(s)["compact"] for s in ["Müller Bau GmbH", "Mueller-Bau", "Müller Bauunternehmung GmbH", "Müller Bau"]}
    assert cores == {"muellerbau"}


def test_trailing_city_is_context_not_name():
    c = org_core("MB Rohbau Berlin")
    assert c["tokens"] == ["mb", "rohbau"] and c["city"] == "Berlin"


def test_token_order_and_synonyms():
    a = org_core("Elektro Schmidt GmbH")["tokens"]
    b = org_core("Schmidt Elektrotechnik GmbH")["tokens"]
    sim, _ = name_similarity(a, b)
    assert sim == 1.0


def test_initials_are_flagged():
    sim, used_initial = name_similarity(["m", "bau"], ["mueller", "bau"])
    assert 0.8 < sim < 0.9 and used_initial


def test_person_names():
    assert person_parts("Becker, Thomas") == {"first": "thomas", "last": "becker"}
    assert person_parts("Hr. Becker") == {"first": "", "last": "becker"}
    t = person_parts("Thomas Becker")
    assert person_name_similarity(t, person_parts("T. Becker"))[0] == 0.85
    assert person_name_similarity(t, person_parts("Jens Becker"))[0] == 0.1
    assert person_name_similarity(t, person_parts("Sabine Wolff"))[0] == 0.0
