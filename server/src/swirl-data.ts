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
    example: 'recv(d1 -> p1, l0, l1)'
  },
  move: {
    name: 'move',
    signature: 'move(data -> port, src, dst)',
    description: 'Moves data from source location to destination location, transferring ownership without duplication.',
    example: 'move(d1 -> p1, l0, {l1, l2})'
  },
  scatter_send: {
    name: 'scatter_send',
    signature: 'scatter_send(stream -> port, src, dst)',
    description: 'High-level representation of a scatter stream dispatch from source to destination worker.',
    example: 'scatter_send(stream_d_files_a -> p_scatter_0_0, l0, l1)'
  },
  gather_recv: {
    name: 'gather_recv',
    signature: 'gather_recv(stream -> port, src, dst)',
    description: 'High-level representation of a gather stream collection arriving from worker into destination.',
    example: 'gather_recv(stream_d_compute_result -> p_compute_result, l1, l0)'
  },
  end: {
    name: 'end',
    signature: 'end()',
    description: 'Atomically terminates and closes its nearest enclosing replication owner, preventing further admissions.',
    example: 'end()'
  }
};

export const SWIRL_KEYWORDS: Record<string, SwirlConstructDoc> = {
  begin: {
    name: 'begin',
    signature: '(begin, scope)',
    description: 'Control signal that opens an execution scope or lifecycle context, matching scope keys exactly.',
    example: 'send((begin, root) -> p_a, source_a, worker)'
  },
  eof: {
    name: 'eof',
    signature: 'eof | (eof, scope)',
    description: 'End-of-flow token representing the termination of a data stream or scoped lifecycle in scatter/gather channels.',
    example: 'send((eof, root) -> p_a, source_a, worker)'
  },
  root: {
    name: 'root',
    signature: 'root',
    description: 'Denotes the common root invocation or empty hierarchical key path.',
    example: 'send((begin, root) -> p_a, source_a, worker)'
  },
  in: {
    name: 'in',
    signature: 'in scope',
    description: 'Scope specifier used in guarded choice branches or replication expressions.',
    example: '+[p_a has data in root]'
  },
  '0': {
    name: '0',
    signature: '0',
    description: 'Nil/zero trace or empty data indicator representing termination or no-op.',
    example: '0'
  },
  U: {
    name: 'U',
    signature: 'U(port, stream[, parentScope])',
    description: 'Finite collection descriptor binding an incoming or outgoing port to an asynchronous stream dataset, optionally scoped to a parent key context.',
    example: 'U(p_results, results, ?parent)'
  },
  has: {
    name: 'has',
    signature: 'port has data [in scope]',
    description: 'Guard condition inspecting whether channel buffer currently contains items available for consumption in the specified scope.',
    example: '+[p_a has data in root]'
  },
  data: {
    name: 'data',
    signature: 'has data [in scope]',
    description: 'Status target in choice branch guard checking for buffered items in scope.',
    example: '+[p_a has data in root]'
  }
};
