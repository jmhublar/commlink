import {inactiveSessionConfiguration,type SessionConfiguration} from './session-policy';

// Joshua approved deployment, binding the existing callback-test task to his
// singular owning dot, and its completion watch. This is a bounded transport
// test of a completed provider turn, not admission or a new task launch.
// The parent proposal is Sentinel_ff3aaed9b61481918085bc71be19fe45;
// Joshua subsequently approved directly in the CommLink worker conversation.
export const callbackPilotConfiguration:SessionConfiguration={
  ...inactiveSessionConfiguration,
  completion_owner_thread_id:'01a1a687-6ecc-75ab-a47f-692abf9d200e',
  callback_jobs:[{
    job_id:'90b3d235-6566-4f10-bbe9-e453b47aad9b',
    owner_key:'email:hublar@proton.me',
    reporter_key:'email:hublar@proton.me',
    owner_thread_id:'01a1a687-6ecc-75ab-a47f-692abf9d200e',
    correlation_id:'2cd92c9b-e50b-4572-a050-8380bfd50776',
    request_message_id:null,
    executor_id:'6afa7af9-b4b0-8191-85ff-e4c046e1d01e',
    turn_id:'01a1e274-da6d-7438-9755-8f1da6397171',
    expires_at:Date.parse('2026-11-16T06:30:00Z'),
    approval_ref:'Joshua direct approval in CommLink worker; parent proposal Sentinel_ff3aaed9b61481918085bc71be19fe45',
    reconciled:false
  }]
};
