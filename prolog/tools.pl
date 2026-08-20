:- module(tools, [tool_call/3, call_agent/3]).

tool_call(Tool, Request, result(Tool, Request)).

call_agent(Agent, Input, result(Agent, Input)).
