:- module(llm, [llm_call/2, llm_call/5]).

llm_call(Request, Response) :-
    Response = Request.

% Stand-in model, the same as the browser runtime's default: a node's
% mock_response if it has one, otherwise "Mock response: " and the prompt.
% Replace this predicate to connect a real model.
llm_call(_Model, _SystemPrompt, _Prompt, Options, Response) :-
    memberchk(mock_response(Mock), Options),
    !,
    Response = Mock.
llm_call(_Model, _SystemPrompt, Prompt, _Options, Response) :-
    format(string(Response), "Mock response: ~w", [Prompt]).
