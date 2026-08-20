:- module(memory, [memory_get/2, memory_put/2, memory_append/2, memory_delete/1]).
:- dynamic memory_store/2.

memory_get(Key, Value) :-
    memory_store(Key, Value).

memory_put(Key, Value) :-
    retractall(memory_store(Key, _)),
    assertz(memory_store(Key, Value)).

memory_append(Key, Value) :-
    ( memory_store(Key, Existing) ->
        append(Existing, [Value], Updated),
        retractall(memory_store(Key, _)),
        assertz(memory_store(Key, Updated))
    ;
        assertz(memory_store(Key, [Value]))
    ).

memory_delete(Key) :-
    retractall(memory_store(Key, _)).
