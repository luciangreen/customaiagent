:- begin_tests(customaiagent).

test(agent_runtime_passthrough) :-
    use_module('../prolog/agent_runtime'),
    run_agent(example, _{question:"hello"}, Output),
    assertion(Output.question == "hello").

:- end_tests(customaiagent).
