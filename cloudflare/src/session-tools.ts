const obj=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const text={type:'string'},id={type:'string',format:'uuid'},version={type:'integer',minimum:1};
const tool=(name:string,description:string,inputSchema:unknown,readOnlyHint=false)=>({name,description,inputSchema,
  annotations:{readOnlyHint,destructiveHint:false,openWorldHint:false}});
export const sessionTools=[
  tool('session_capabilities','Read the proposed roles/tier menu and current default-deny policy/capability state. This never grants launch authority.',obj({}),true),
  tool('session_validate','Dry-run a versioned request. Eligibility is not reservation or authorization to launch.',obj({request:{type:['object','string']}}),true),
  tool('session_status','Read a durable status for your own request. No cloud polling or execution.',obj({request_message_id:id}),true),
  tool('session_receive','Owning coordinator only: register an actual Robut mailbox MSG and durably admit, hold or reject it. Does not acknowledge or launch.',obj({request_message_id:id})),
  tool('session_prepare_launch','Owning coordinator only: recheck immutable policy/menu and reserve one external launch intent. Call create_thread at most once for the returned intent. Lost responses require reconciliation.',obj({request_message_id:id,expected_version:version})),
  tool('session_transition','Owning coordinator only: record observed provider state with version/fence checks. This cannot launch, cancel, activate policy or retry an uncertain launch.',obj({request_message_id:id,expected_version:version,fence:id,event:{type:'string',enum:['submitted','running','finished','failed','uncertain']},executor_id:text,result:{type:'object'},evidence:{type:'object'}},['request_message_id','expected_version','fence','event'])),
  tool('session_outbox','Owning coordinator only: read durable lifecycle envelopes. Send unchanged using send and the same message ID; record acceptance separately.',obj({limit:{type:'integer',minimum:1,maximum:50}},[]),true),
  tool('session_recovery','Owning coordinator only: recover active reservation state, fence and known executor ID after a restart. Never returns another launch permit.',obj({}),true),
  tool('session_outbox_mark_sent','Owning coordinator only: mark an outbox envelope sent only after its exact mailbox copy exists. This is not Robut recipient acknowledgment.',obj({message_id:id}))
];
