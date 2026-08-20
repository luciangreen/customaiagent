:- module(agent_runtime, [run_agent/3, run_agent/5, agent_input/3, agent_output/3]).

run_agent(_Agent, Input, Output) :-
    run_agent(_Agent, Input, _{}, Output, _{}).

run_agent(_Agent, Input, State0, Output, State) :-
    State = State0,
    Output = Input.

agent_input(Key, Dict, Value) :-
    get_dict(Key, Dict, Value).

agent_output(Key, Dict, Value) :-
    get_dict(Key, Dict, Value).
