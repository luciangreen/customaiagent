:- begin_tests(customaiagent).

test(agent_runtime_passthrough) :-
    use_module('../prolog/agent_runtime'),
    run_agent(example, _{question:"hello"}, Output),
    assertion(Output.question == "hello").

test(llm_mock_response_option) :-
    use_module('../prolog/llm'),
    llm:llm_call(m, "", "What is 2+2?", [mock_response(math)], R),
    R == math.

test(llm_default_mock_matches_browser) :-
    use_module('../prolog/llm'),
    llm:llm_call(m, "", "hi", [], R),
    R == "Mock response: hi".

:- end_tests(customaiagent).
