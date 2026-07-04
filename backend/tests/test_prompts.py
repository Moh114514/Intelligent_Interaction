from backend.app.agent.prompts import compose_system_prompt


def tool(name: str, description: str = "test") -> dict:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {}}}


def test_prompt_layers_execution_tools_and_persona() -> None:
    tools = [tool("system_current_time"), tool("files_search_names"), tool("files_replace_text")]
    black = compose_system_prompt("BLACK", tools)
    white = compose_system_prompt("WHITE", tools)

    assert "# Agent Execution Contract" in black
    assert "untrusted data" in black
    assert "`files_search_names`" in black
    assert "file_id" in black
    assert "exact target and complete content" in black
    assert "Kuro" in black and "Shiro" not in black
    assert "Shiro" in white and black != white
    assert "files_create_text" not in black


def test_prompt_does_not_mention_unregistered_tools() -> None:
    prompt = compose_system_prompt("BLACK", [tool("system_info")])
    assert "system_info" in prompt
    assert "files_search_names" not in prompt
    assert "clipboard_write_text" not in prompt
