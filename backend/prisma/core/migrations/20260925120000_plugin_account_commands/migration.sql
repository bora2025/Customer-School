CREATE TABLE "PluginAccountCommand" (
  "id" TEXT NOT NULL,
  "pluginId" TEXT NOT NULL,
  "commandKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PluginAccountCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluginAccountCommand_pluginId_commandKey_key"
  ON "PluginAccountCommand"("pluginId", "commandKey");
CREATE INDEX "PluginAccountCommand_userId_idx" ON "PluginAccountCommand"("userId");
