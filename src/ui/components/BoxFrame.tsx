import React from 'react';
import { Panel } from '../../components/ui/panel/index.js';

export interface BoxFrameProps {
  readonly title: string;
  readonly badge?: string;
  readonly badgeColor?: string;
  readonly children: React.ReactNode;
  readonly width?: number;
  readonly borderColor?: string;
  readonly paddingX?: number;
  readonly paddingY?: number;
}

export const BoxFrame = ({
  title, badge, children, width,
  borderColor, paddingX = 1,
}: BoxFrameProps): React.JSX.Element => {
  const panelTitle = badge ? `${title} [${badge}]` : title;
  return (
    <Panel
      title={panelTitle}
      borderStyle="single"
      borderColor={borderColor}
      padding={paddingX}
      width={width ?? 'auto'}
    >
      {children}
    </Panel>
  );
};

