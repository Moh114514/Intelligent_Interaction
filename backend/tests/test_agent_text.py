from backend.app.agent.text import strip_role_prefix

def test_strip_role_prefix_handles_repeated_and_partial_labels() -> None:
    assert strip_role_prefix("[Vanguard][Vanguard] Ready") == "Ready"
    assert strip_role_prefix("Kuro：你好") == "你好"
    assert strip_role_prefix("[Van", final=False) == ""
    assert strip_role_prefix("   ", final=False) == ""
    assert strip_role_prefix("普通回答", final=False) == "普通回答"
