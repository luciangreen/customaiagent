:- module(llm, [llm_call/2, llm_call/5]).

llm_call(Request, Response) :-
    Response = Request.

llm_call(_Model, _SystemPrompt, Prompt, _Options, Response) :-
    Response = Prompt.
