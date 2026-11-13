import type { RetrospectNode, RetrospectEdge } from './model.ts';
export interface ReviewPicture { id: string; url?: string; width?: number; height?: number; parametersUnavailable?: boolean; thumbnailOnly?: boolean }
export type ImageView = 'A' | 'B' | 'pair';
export type GraphTool = 'view' | 'pan' | 'select' | 'annotate';
export type SelectionMode = 'single' | 'multi' | 'box';
export type GraphObject = { kind: 'node'; node: RetrospectNode; key: string; title: string } | { kind: 'edge'; edge: RetrospectEdge; key: string; title: string };
export interface NoteTarget { key: string; items: readonly GraphObject[]; title: string; viewport: HTMLElement; bounds: () => { left: number; right: number; top: number; bottom: number } }
export interface Point { x: number; y: number; distance?: number }
/** Main image's left edge and vertical center, in world coordinates. */
export interface NodeAnchor { x: number; cy: number; z: number }
export type NodeLayout = Readonly<Record<string, NodeAnchor>>;
export interface ContinuationAnchor extends NodeAnchor { nodeId: string }
/** Page-only canvas view, saved when leaving the graph. */
export interface GraphCamera { x: number; y: number; scale: number; fitted: number; overview: boolean }
