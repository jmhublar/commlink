const obj=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const text={type:'string'},id={type:'string',format:'uuid'},version={type:'integer',minimum:1};
const tool=(name:string,description:string,inputSchema:unknown,readOnlyHint=false)=>({name,description,inputSchema,
  annotations:{readOnlyHint,destructiveHint:false,openWorldHint:false}});
const completionPlan=obj({owner_thread_id:text,explicit_callback:obj({mode:{type:'string',enum:['thread_message','unavailable']},tool_name:{type:['string','null']}}),
  platform_push:{type:'string',enum:['declared','unavailable']},recovery:obj({automation_id:text,owner_thread_id:text,kind:{type:'string',enum:['one_shot','recurring']},
    due_at:{type:'integer',minimum:0},expires_at:{type:'integer',minimum:0},max_checks:{type:'integer',minimum:1,maximum:24},cadence_seconds:{type:['integer','null'],minimum:3600}})});
const completionSignal=obj({event_id:text,source:{type:'string',enum:['explicit_child','platform_push','scheduled_recovery']},owner_thread_id:text,
  executor_id:{type:['string','null']},correlation_id:id,sender_thread_id:{type:['string','null']},automation_id:{type:['string','null']}});
const completionObservation=obj({executor_id:text,turn_id:text,source:{type:'string',enum:['read_thread','wait_threads']},state:{type:'string',enum:['running','attention','unknown']}});
export const sessionTools=[
  tool('session_capabilities','Read the proposed roles/tier menu and current default-deny policy/capability state. This never grants launch authority.',obj({}),true),
  tool('session_validate','Dry-run a versioned request. Eligibility is not reservation or authorization to launch.',obj({request:{type:['object','string']}}),true),
  tool('session_status','Read a durable status for your own request. No cloud polling or execution.',obj({request_message_id:id}),true),
  tool('session_receive','Owning coordinator only: register an actual Robut mailbox MSG and durably admit, hold or reject it. Does not acknowledge or launch.',obj({request_message_id:id})),
  tool('session_prepare_launch','Owning coordinator only: recheck immutable policy/menu and reserve one external launch intent. Call create_thread at most once for the returned intent. Lost responses require reconciliation.',obj({request_message_id:id,expected_version:version})),
  tool('session_transition','Owning coordinator only: record observed provider state with version/fence checks. This cannot launch, cancel, activate policy or retry an uncertain launch.',obj({request_message_id:id,expected_version:version,fence:id,event:{type:'string',enum:['submitted','running','finished','failed','uncertain']},executor_id:text,result:{type:'object'},evidence:{type:'object'}},['request_message_id','expected_version','fence','event'])),
  tool('session_outbox','Owning coordinator only: read durable lifecycle envelopes. Send unchanged using send and the same message ID; record acceptance separately.',obj({limit:{type:'integer',minimum:1,maximum:50}},[]),true),
  tool('session_recovery','Owning coordinator only: recover active reservation state, fence and known executor ID after a restart. Never returns another launch permit.',obj({}),true),
  tool('session_outbox_mark_sent','Owning coordinator only: mark an outbox envelope sent only after its exact mailbox copy exists. This is not Robut recipient acknowledgment.',obj({message_id:id})),
  tool('session_completion_register','Owning coordinator only: persist the verified root-bound callback and saved bounded recovery plan before launch. Does not create a schedule or grant authority.',obj({request_message_id:id,plan:completionPlan})),
  tool('session_completion_bind','Owning coordinator only: bind the actual provider turn ID to the submitted task after read_thread. Immutable; never creates a task.',obj({request_message_id:id,executor_id:text,turn_id:text})),
  tool('session_completion_signal','Owning coordinator only: record an observed child, platform or root-scheduled hint with verified host metadata. A hint never proves completion.',obj({request_message_id:id,signal:completionSignal})),
  tool('session_completion_observe','Owning coordinator only: persist a nonterminal provider lookup for the exact bound task/turn. Attention or uncertainty never clears a reservation.',obj({request_message_id:id,observation:completionObservation})),
  tool('session_completion_recovery','Owning coordinator only: inspect persisted completion routes, task/turn bindings and bounded recovery attention state. Does not wake, poll or launch.',obj({limit:{type:'integer',minimum:1,maximum:50}},[]),true)
];
