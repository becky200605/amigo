import type { ToolInterface } from "@amigo-llm/types";
import { systemReservedTags } from "@amigo-llm/types";
import type {
  ToolExecutionContext,
  ToolNames,
  ToolParamDefinition,
  ToolResult,
} from "@amigo-llm/types/src/tool";
import { XMLParser } from "fast-xml-parser";
import { ensureArray } from "@/utils/array";
import { logger } from "@/utils/logger";
import { AskFollowupQuestions } from "./askFollowupQuestions";
import { Bash } from "./bash";
import { BrowserSearch } from "./browserSearch";
import { CompleteTask } from "./completeTask";
import { CompletionResult } from "./completionResult";
import { EditFile } from "./editFile";
import { PolicyKnowledgeSearch } from "./policyKnowledgeSearch";
import { ReadFile } from "./readFile";
import {
  CreateTaskDocs,
  ExecuteTaskList,
  GetTaskListProgress,
  ReadTaskDocs,
  UpdateTaskList,
} from "./taskDocs/index";

type ParamDefinition = ToolParamDefinition<string>;
type XmlObject = Record<string, unknown>;

const toRecord = (value: unknown): XmlObject => {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as XmlObject) : {};
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export class ToolService {
  private _availableTools: Record<string, ToolInterface> = {};

  constructor(
    private _baseTools: ToolInterface[],
    private userDefinedTools: ToolInterface[],
  ) {
    this._baseTools.concat(this.userDefinedTools).forEach((tool) => {
      this._availableTools[tool.name] = tool;
    });
  }

  get toolNames() {
    return Object.keys(this._availableTools);
  }

  get baseTools() {
    return this._baseTools;
  }

  get customedTools() {
    return this.userDefinedTools;
  }

  public getAllTools() {
    return [...this._baseTools, ...this.userDefinedTools];
  }

  public getToolFromName(name: string): ToolInterface | undefined {
    return this._availableTools[name];
  }

  public async parseAndExecute({
    xmlParams,
    context,
  }: {
    xmlParams: string;
    context: ToolExecutionContext;
  }): Promise<{
    message: string;
    params: Record<string, unknown> | string;
    toolResult: ToolResult<ToolNames>;
    error?: string;
  }> {
    try {
      const { params, toolName, error } = this.parseParams(xmlParams);

      if (error) {
        logger.error("[ToolService] Tool parameter parse error:", error);
        return {
          message: error,
          toolResult: "",
          params,
          error,
        };
      }

      const tool = this._availableTools[toolName || ""];
      if (!tool) {
        const errorMsg = `Tool '${toolName}' does not exist. Please use a valid tool name.`;
        return {
          message: errorMsg,
          toolResult: "",
          params,
          error: errorMsg,
        };
      }

      const { toolResult, message } = await tool.invoke({
        params,
        context,
      });
      logger.debug("[ToolService] Tool invocation completed:", toolName, params, toolResult);

      return { message, toolResult: toolResult as ToolResult<ToolNames>, params };
    } catch (err) {
      const errorMsg = `Tool execution error: ${err instanceof Error ? err.message : String(err)}`;
      logger.error("[ToolService] Tool execution exception:", err);
      return {
        message: errorMsg,
        toolResult: "",
        params: {},
        error: errorMsg,
      };
    }
  }

  private collectLeafNodePaths(paramDefs: ParamDefinition[]): string[] {
    const paths: string[] = [];
    for (const param of paramDefs) {
      if (!param.params || param.params.length === 0) {
        paths.push(`*.${param.name}`);
      } else {
        paths.push(...this.collectLeafNodePaths(param.params));
      }
    }
    return paths;
  }

  private collectAllParamTagNames(): string[] {
    const tagNames = new Set<string>();

    const collectFromParams = (params: ParamDefinition[]) => {
      for (const param of params) {
        tagNames.add(param.name);
        if (param.params && param.params.length > 0) {
          collectFromParams(param.params);
        }
      }
    };

    for (const tool of Object.values(this._availableTools)) {
      if (tool.params) {
        collectFromParams(tool.params as ParamDefinition[]);
      }
    }

    return [...tagNames];
  }

  public parseParams(
    buffer: string,
    partial = false,
  ): {
    params: Record<string, unknown> | string;
    toolName: string;
    error?: string;
  } {
    try {
      const completedXml = this.completePartialXml(buffer);

      const simpleParser = new XMLParser({ ignoreAttributes: true });
      const preParseResult = toRecord(simpleParser.parse(completedXml));
      const toolName = Object.keys(preParseResult).find((key) => this._availableTools[key]) || "";
      const tool = this._availableTools[toolName];

      if (!tool) {
        const firstKey = Object.keys(preParseResult)[0] || "";
        if (!partial) {
          logger.warn(`[parseTool] Tool '${toolName || firstKey}' was not found.`);
        }
        return {
          params: {},
          toolName: toolName || firstKey,
        };
      }

      const paramDefinitions = tool.params as ParamDefinition[];
      const hasParams = paramDefinitions.length !== 0;
      const stopNodes = hasParams ? this.collectLeafNodePaths(paramDefinitions) : [toolName];

      const parser = new XMLParser({
        ignoreAttributes: false,
        trimValues: true,
        stopNodes,
      });
      const jsonOutput = toRecord(parser.parse(completedXml));
      const toolValue = jsonOutput[toolName];

      const finalParams = hasParams
        ? this.mapAndValidateParams(toolValue, paramDefinitions, partial, toolName)
        : String(toolValue ?? "");

      return { params: finalParams, toolName };
    } catch (err) {
      const errorMsg = `XML parse error: ${err instanceof Error ? err.message : String(err)}

Please use child tag syntax instead of attributes.

Wrong: <tool param1="value1" param2="value2"/>
Right: <tool><param1>value1</param1><param2>value2</param2></tool>`;
      logger.error("[parseParams] Parse failed:", err);
      return {
        params: {},
        toolName: "",
        error: errorMsg,
      };
    }
  }

  private completePartialXml(xmlString: string): string {
    let processedString = xmlString;

    const cdataStartPattern = /<!\[CDATA\[/g;
    const cdataEndPattern = /\]\]>/g;
    let cdataStartCount = 0;
    let cdataEndCount = 0;

    let match = cdataStartPattern.exec(processedString);
    while (match !== null) {
      cdataStartCount++;
      match = cdataStartPattern.exec(processedString);
    }

    match = cdataEndPattern.exec(processedString);
    while (match !== null) {
      cdataEndCount++;
      match = cdataEndPattern.exec(processedString);
    }

    if (cdataStartCount > cdataEndCount) {
      const lastCdataStart = processedString.lastIndexOf("<![CDATA[");
      if (lastCdataStart > -1) {
        processedString = processedString.substring(0, lastCdataStart);
      }
    }

    const lastOpenBracketIndex = processedString.lastIndexOf("<");
    const lastCloseBracketIndex = processedString.lastIndexOf(">");
    if (lastOpenBracketIndex > -1 && lastOpenBracketIndex > lastCloseBracketIndex) {
      processedString = processedString.substring(0, lastOpenBracketIndex);
    }

    const allTags = [...systemReservedTags, ...this.toolNames, ...this.collectAllParamTagNames()];
    if (allTags.length === 0) {
      return processedString;
    }

    const tagPattern = allTags.map(escapeRegExp).join("|");
    const tagRegex = new RegExp(`<(${tagPattern})\\b[^>]*>|<\\/(${tagPattern})>`, "g");
    const openTags: string[] = [];
    let tagMatch = tagRegex.exec(processedString);

    while (tagMatch !== null) {
      if (tagMatch[1]) {
        openTags.push(tagMatch[1]);
      } else if (
        tagMatch[2] &&
        openTags.length > 0 &&
        openTags[openTags.length - 1] === tagMatch[2]
      ) {
        openTags.pop();
      }
      tagMatch = tagRegex.exec(processedString);
    }

    let completedString = processedString;
    while (openTags.length > 0) {
      const tagToClose = openTags.pop();
      if (tagToClose) {
        completedString += `</${tagToClose}>`;
      }
    }

    return completedString;
  }

  private mapAndValidateParams(
    rawData: unknown,
    paramDefinitions: ParamDefinition[],
    partial = false,
    toolName = "",
  ): Record<string, unknown> {
    if (!rawData || typeof rawData !== "object") {
      logger.warn("[parseTool] data is not object");
    }

    const source = toRecord(rawData);
    const finalParams: Record<string, unknown> = {};
    const missingParams: string[] = [];

    for (const paramDef of paramDefinitions) {
      const rawValue = source[paramDef.name];

      if (!paramDef.optional && (rawValue === undefined || rawValue === null)) {
        if (partial) {
          continue;
        }
        missingParams.push(paramDef.name);
        continue;
      }

      if (rawValue === undefined) {
        continue;
      }

      if (paramDef.type === "array") {
        const childDefs = paramDef.params ?? [];
        if (childDefs.length !== 1) {
          logger.warn(
            `[parseTool] Array type param '${paramDef.name}' should have exactly one child definition.`,
          );
          continue;
        }

        const childTag = childDefs[0];
        const rawArray = this.extractArrayValue(rawValue, childTag);
        if (childTag.params && childTag.params.length > 0) {
          finalParams[paramDef.name] = rawArray.map((item) =>
            this.mapAndValidateParams(item, childTag.params ?? [], partial),
          );
        } else {
          finalParams[paramDef.name] = rawArray;
        }
      } else if (paramDef.params && paramDef.params.length > 0) {
        finalParams[paramDef.name] = this.mapAndValidateParams(rawValue, paramDef.params, partial);
      } else {
        finalParams[paramDef.name] = rawValue;
      }
    }

    if (missingParams.length > 0 && !partial) {
      throw new Error(
        `Tool '${toolName}' is missing required parameters: ${missingParams.join(", ")}.`,
      );
    }

    return finalParams;
  }

  private extractArrayValue(rawValue: unknown, childTag: ParamDefinition): unknown[] {
    if (Array.isArray(rawValue)) {
      return rawValue;
    }

    const rawRecord = toRecord(rawValue);
    if (Object.hasOwn(rawRecord, childTag.name)) {
      return ensureArray(rawRecord[childTag.name]);
    }

    return ensureArray(rawValue);
  }
}

export const MAIN_BASIC_TOOLS: ToolInterface[] = [
  AskFollowupQuestions,
  CompletionResult,
  CompleteTask,
  BrowserSearch,
  PolicyKnowledgeSearch,
  EditFile,
  ReadFile,
  Bash,
  CreateTaskDocs,
  ReadTaskDocs,
  ExecuteTaskList,
  GetTaskListProgress,
];

export const SUB_BASIC_TOOLS: ToolInterface[] = [
  BrowserSearch,
  PolicyKnowledgeSearch,
  EditFile,
  ReadFile,
  Bash,
  CreateTaskDocs,
  ReadTaskDocs,
  UpdateTaskList,
  CompleteTask,
];

export const CUSTOMED_TOOLS: ToolInterface[] = [];

export {
  AskFollowupQuestions,
  CompletionResult,
  CompleteTask,
  BrowserSearch,
  PolicyKnowledgeSearch,
  EditFile,
  ReadFile,
  Bash,
  CreateTaskDocs,
  ReadTaskDocs,
  UpdateTaskList,
  GetTaskListProgress,
  ExecuteTaskList,
};
