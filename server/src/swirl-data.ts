export interface SwirlConstructDoc {
  name: string;
  signature: string;
  description: string;
  example: string;
}

export const SWIRL_PREDICATES: Record<string, SwirlConstructDoc> = {
  exec: {
    name: 'exec',
    signature: 'exec(step, flow, mapping)',
    description: 'Executes a computational step mapped to target locations with input-to-output data flow.',
    example: 'exec(s1, {(p_in, d_in)} -> {(p_out, d_out)}, {l0})'
  },
  send: {
    name: 'send',
    signature: 'send(data -> port, src, dst)',
    description: 'Sends data to a target port from the source location to one or more destination locations.',
    example: 'send(d1 -> p1, l0, l1)'
  },
  recv: {
    name: 'recv',
    signature: 'recv(data -> port, src, dst)',
    description: 'Receives data arriving on a port from a source location into the destination location.',
    example: 'recv(p1 -> d1, l0, l1)'
  },
  move: {
    name: 'move',
    signature: 'move(data -> port, src, dst)',
    description: 'Moves data from source location to destination location, transferring ownership without duplication.',
    example: 'move(d1 -> p1, l0, {l1, l2})'
  }
};

export const SWIRL_KEYWORDS: Record<string, SwirlConstructDoc> = {
  eof: {
    name: 'eof',
    signature: 'eof',
    description: 'End-of-flow token representing the termination of a data stream in loops or scatter/gather channels.',
    example: 'send(eof -> p_id, l0, l1)'
  },
  in: {
    name: 'in',
    signature: 'in',
    description: 'Keyword used in replication or membership expressions.',
    example: '![i in 0..N] ...'
  },
  '0': {
    name: '0',
    signature: '0',
    description: 'Nil/zero trace or empty data indicator representing termination or no-op.',
    example: '0'
  }
};
