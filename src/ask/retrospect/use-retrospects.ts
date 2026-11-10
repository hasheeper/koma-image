import { computed } from 'vue';
import { useAsk } from '../../app/ask.ts';
import type { ReviewRecord } from './store.ts';
export function useRetrospects() {
  const ask=useAsk(),registry=ask.retrospects;
  return {registry,active:computed(()=>registry.activeForBoard(ask.evolutionTarget.value)),
    boardName:(record:ReviewRecord)=>ask.evolutionName(record.boardId),open:registry.open};
}
