import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import type { ReactNode } from "react";

import { PageHeader, type PageHeaderProps } from "@/design-system/components/PageHeader";

export interface DetailsTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface DetailsPageLayoutProps extends PageHeaderProps {
  /** Summary block rendered between the header and the tabs — key facts about the entity. */
  summary?: ReactNode;
  tabs: DetailsTab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
}

/**
 * The standard entity-details page shape: header (with status + actions) →
 * summary → tabs (Overview / Configuration / Related Records / Activity /
 * Audit, per spec §18) → tab content. Domains provide the tab list; this
 * component owns layout only.
 */
export function DetailsPageLayout({
  summary,
  tabs,
  activeTabId,
  onTabChange,
  ...headerProps
}: DetailsPageLayoutProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return (
    <Box>
      <PageHeader {...headerProps} />
      {summary && <Box sx={{ mb: 3 }}>{summary}</Box>}
      <Tabs
        value={activeTab?.id}
        onChange={(_event, value: string) => onTabChange(value)}
        sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}
      >
        {tabs.map((tab) => (
          <Tab key={tab.id} value={tab.id} label={tab.label} />
        ))}
      </Tabs>
      <Box>{activeTab?.content}</Box>
    </Box>
  );
}
