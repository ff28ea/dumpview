type SymbolKind = 'class' | 'struct' | 'enum'

interface OffsetEntry {
  key: string
  value: string
}

export interface PreviewLoadSummary {
  sourceLabel: string
  symbolCount: number
  classCount: number
  structCount: number
  enumCount: number
  functionOwnerCount: number
  methodCount: number
  relationCount: number
  offsets: OffsetEntry[]
  landingSymbol: string | null
}

export interface PreviewSearchResult {
  name: string
  kind: SymbolKind
  parent: string | null
  size: number | null
  fieldCount: number
  methodCount: number
  relationCount: number
  childCount: number
  subtitle: string
}

interface SymbolLink {
  name: string
  kind: SymbolKind
}

interface FieldInfo {
  name: string
  typeDisplay: string
  offset: number | null
  size: number | null
  arrayDim: number | null
  links: SymbolLink[]
}

interface ParameterInfo {
  name: string
  typeDisplay: string
  links: SymbolLink[]
}

interface MethodInfo {
  name: string
  returnType: string
  returnLinks: SymbolLink[]
  parameters: ParameterInfo[]
  address: number | null
  flags: string
}

interface EnumValueInfo {
  name: string
  value: string
}

interface RelationInfo {
  name: string
  kind: SymbolKind
  relation: string
  via: string
}

export interface PreviewSymbolDetail {
  name: string
  kind: SymbolKind
  size: number | null
  parent: string | null
  parents: SymbolLink[]
  directChildren: SymbolLink[]
  fields: FieldInfo[]
  methods: MethodInfo[]
  enumValues: EnumValueInfo[]
  underlyingType: string | null
  related: RelationInfo[]
  incomingRefs: RelationInfo[]
  fieldCount: number
  methodCount: number
  relationCount: number
  childCount: number
}

export type PreviewScenario = 'main' | 'relation' | 'framework' | 'workspace' | 'games'

export interface PreviewWorkspaceSummary {
  id: string
  title: string
  sourceLabel: string
  updatedAtMs: number
  nodeCount: number
  edgeCount: number
  path: string
}

export interface PreviewWorkspaceDocument {
  id: string
  title: string
  sourceLabel: string
  createdAtMs: number
  updatedAtMs: number
  nodes: Array<{
    id: string
    symbolName: string
    x: number
    y: number
    selectedFieldNames: string[]
  }>
  edges: Array<{
    id: string
    sourceNodeId: string
    sourceHandleId?: string | null
    targetNodeId: string
    label: string
    kind: 'field' | 'parent'
  }>
}

function link(name: string, kind: SymbolKind): SymbolLink {
  return { name, kind }
}

function field(
  name: string,
  typeDisplay: string,
  offset: number | null,
  size: number | null,
  links: SymbolLink[] = [],
  arrayDim: number | null = null,
): FieldInfo {
  return {
    name,
    typeDisplay,
    offset,
    size,
    arrayDim,
    links,
  }
}

function parameter(name: string, typeDisplay: string, links: SymbolLink[] = []): ParameterInfo {
  return {
    name,
    typeDisplay,
    links,
  }
}

function method(
  name: string,
  returnType: string,
  address: number,
  flags: string,
  parameters: ParameterInfo[] = [],
  returnLinks: SymbolLink[] = [],
): MethodInfo {
  return {
    name,
    returnType,
    returnLinks,
    parameters,
    address,
    flags,
  }
}

function relation(
  name: string,
  kind: SymbolKind,
  relationKind: string,
  via: string,
): RelationInfo {
  return {
    name,
    kind,
    relation: relationKind,
    via,
  }
}

function createDetail(
  detail: Partial<PreviewSymbolDetail> & Pick<PreviewSymbolDetail, 'name' | 'kind'>,
): PreviewSymbolDetail {
  const directChildren = detail.directChildren ?? []
  const fields = detail.fields ?? []
  const methods = detail.methods ?? []
  const related = detail.related ?? []
  const incomingRefs = detail.incomingRefs ?? []

  return {
    size: null,
    parent: null,
    parents: [],
    enumValues: [],
    underlyingType: null,
    ...detail,
    directChildren,
    fields,
    methods,
    related,
    incomingRefs,
    fieldCount: detail.fieldCount ?? fields.length,
    methodCount: detail.methodCount ?? methods.length,
    relationCount: detail.relationCount ?? related.length + incomingRefs.length,
    childCount: detail.childCount ?? directChildren.length,
  }
}

const previewSearchResults: PreviewSearchResult[] = [
  {
    name: 'AAIController',
    kind: 'class',
    parent: 'AController',
    size: 944,
    fieldCount: 11,
    methodCount: 24,
    relationCount: 19,
    childCount: 2,
    subtitle: 'extends AController | 944 bytes | 11 fields | 24 methods',
  },
  {
    name: 'AAudioVolume',
    kind: 'class',
    parent: 'AVolume',
    size: 824,
    fieldCount: 6,
    methodCount: 7,
    relationCount: 10,
    childCount: 0,
    subtitle: 'extends AVolume | 824 bytes | 6 fields | 7 methods',
  },
  {
    name: 'ACharacter',
    kind: 'class',
    parent: 'APawn',
    size: 944,
    fieldCount: 18,
    methodCount: 32,
    relationCount: 24,
    childCount: 1,
    subtitle: 'extends APawn | 944 bytes | 18 fields | 32 methods',
  },
  {
    name: 'ADirectionalLight',
    kind: 'class',
    parent: 'ALight',
    size: 832,
    fieldCount: 2,
    methodCount: 4,
    relationCount: 5,
    childCount: 0,
    subtitle: 'extends ALight | 832 bytes | 2 fields | 4 methods',
  },
  {
    name: 'ALight',
    kind: 'class',
    parent: 'AInfo',
    size: 816,
    fieldCount: 3,
    methodCount: 5,
    relationCount: 11,
    childCount: 4,
    subtitle: 'extends AInfo | 816 bytes | 3 fields | 5 methods | 4 children',
  },
  {
    name: 'APointLight',
    kind: 'class',
    parent: 'ALight',
    size: 848,
    fieldCount: 4,
    methodCount: 5,
    relationCount: 7,
    childCount: 0,
    subtitle: 'extends ALight | 848 bytes | 4 fields | 5 methods',
  },
  {
    name: 'APlayerController',
    kind: 'class',
    parent: 'AController',
    size: 2104,
    fieldCount: 9,
    methodCount: 18,
    relationCount: 14,
    childCount: 1,
    subtitle: 'extends AController | 2104 bytes | 9 fields | 18 methods',
  },
  {
    name: 'ARectLight',
    kind: 'class',
    parent: 'ALight',
    size: 864,
    fieldCount: 4,
    methodCount: 4,
    relationCount: 6,
    childCount: 0,
    subtitle: 'extends ALight | 864 bytes | 4 fields | 4 methods',
  },
  {
    name: 'ASpotLight',
    kind: 'class',
    parent: 'ALight',
    size: 848,
    fieldCount: 4,
    methodCount: 4,
    relationCount: 6,
    childCount: 0,
    subtitle: 'extends ALight | 848 bytes | 4 fields | 4 methods',
  },
  {
    name: 'UGameInstance',
    kind: 'class',
    parent: 'UObject',
    size: 416,
    fieldCount: 5,
    methodCount: 7,
    relationCount: 9,
    childCount: 1,
    subtitle: 'extends UObject | 416 bytes | 5 fields | 7 methods',
  },
  {
    name: 'ULocalPlayer',
    kind: 'class',
    parent: 'UPlayer',
    size: 416,
    fieldCount: 5,
    methodCount: 6,
    relationCount: 8,
    childCount: 1,
    subtitle: 'extends UPlayer | 416 bytes | 5 fields | 6 methods',
  },
  {
    name: 'UVisual',
    kind: 'class',
    parent: 'UObject',
    size: 48,
    fieldCount: 1,
    methodCount: 1,
    relationCount: 2,
    childCount: 1,
    subtitle: 'extends UObject | 48 bytes | 1 field | 1 method',
  },
  {
    name: 'UWidget',
    kind: 'class',
    parent: 'UVisual',
    size: 736,
    fieldCount: 14,
    methodCount: 21,
    relationCount: 18,
    childCount: 1,
    subtitle: 'extends UVisual | 736 bytes | 14 fields | 21 methods',
  },
  {
    name: 'UWorld',
    kind: 'class',
    parent: 'UObject',
    size: 1728,
    fieldCount: 9,
    methodCount: 10,
    relationCount: 9,
    childCount: 0,
    subtitle: 'extends UObject | 1728 bytes | 9 fields | 10 methods',
  },
]

const previewDetails = new Map<string, PreviewSymbolDetail>([
  [
    'AAudioVolume',
    createDetail({
      name: 'AAudioVolume',
      kind: 'class',
      size: 824,
      parent: 'AVolume',
      parents: [
        link('AVolume', 'class'),
        link('ABrush', 'class'),
        link('AActor', 'class'),
        link('UObject', 'class'),
      ],
      fields: [
        field('Priority', 'float', 0x2c8, 4),
        field('bEnabled', 'uint8', 0x2cc, 1),
        field('Settings', 'FReverbSettings', 0x2d0, 0x20, [link('FReverbSettings', 'struct')]),
        field(
          'SubmixSendSettings',
          'FAudioVolumeSubmixSendSettings',
          0x2f0,
          0x28,
          [link('FAudioVolumeSubmixSendSettings', 'struct')],
        ),
        field(
          'InteriorSettings',
          'FInteriorSettings',
          0x318,
          0x28,
          [link('FInteriorSettings', 'struct')],
        ),
        field(
          'SubmixOverrideSettings',
          'FAudioVolumeSubmixOverrideSettings',
          0x340,
          0x30,
          [link('FAudioVolumeSubmixOverrideSettings', 'struct')],
        ),
      ],
      methods: [
        method(
          'EncompassesPoint',
          'bool',
          0x1403ac120,
          'Final | Native | Public',
          [
            parameter('Point', 'FVector', [link('FVector', 'struct')]),
            parameter('SphereRadius', 'float'),
            parameter('DistanceToPoint', 'float&'),
          ],
        ),
        method(
          'GetInteriorSettings',
          'void',
          0x1403abf90,
          'Final | Native | Public',
          [parameter('OutInteriorSettings', 'FInteriorSettings&', [link('FInteriorSettings', 'struct')])],
        ),
        method(
          'GetProxyVolume',
          'AAudioVolume*',
          0x1403ac2a0,
          'Final | Native | Public',
          [],
          [link('AAudioVolume', 'class')],
        ),
        method(
          'SetEnabled',
          'void',
          0x1403ac5d0,
          'Final | Native | Public | BlueprintCallable',
          [parameter('bNewEnabled', 'bool')],
        ),
        method(
          'SetPriority',
          'void',
          0x1403ac610,
          'Final | Native | Public | BlueprintCallable',
          [parameter('NewPriority', 'float')],
        ),
        method(
          'SetReverbSettings',
          'void',
          0x1403ac660,
          'Final | Native | Public | BlueprintCallable',
          [parameter('NewSettings', 'FReverbSettings', [link('FReverbSettings', 'struct')])],
        ),
        method(
          'SetSubmixSendSettings',
          'void',
          0x1403ac760,
          'Final | Native | Public | BlueprintCallable',
          [
            parameter('NewSettings', 'FAudioVolumeSubmixSendSettings', [
              link('FAudioVolumeSubmixSendSettings', 'struct'),
            ]),
          ],
        ),
      ],
      related: [
        relation('FReverbSettings', 'struct', 'field', 'Settings'),
        relation('FAudioVolumeSubmixSendSettings', 'struct', 'field', 'SubmixSendSettings'),
        relation('FInteriorSettings', 'struct', 'field', 'InteriorSettings'),
        relation(
          'FAudioVolumeSubmixOverrideSettings',
          'struct',
          'field',
          'SubmixOverrideSettings',
        ),
      ],
      incomingRefs: [relation('ULevel', 'class', 'field', 'AudioVolume')],
    }),
  ],
  [
    'ALight',
    createDetail({
      name: 'ALight',
      kind: 'class',
      size: 816,
      parent: 'AInfo',
      parents: [link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [
        link('ADirectionalLight', 'class'),
        link('APointLight', 'class'),
        link('ARectLight', 'class'),
        link('ASpotLight', 'class'),
      ],
      fields: [
        field('LightComponent', 'ULightComponent*', 0x2f8, 8, [link('ULightComponent', 'class')]),
        field('LightGuid', 'FGuid', 0x300, 16),
        field('BloomTint', 'FLinearColor', 0x310, 16, [link('FLinearColor', 'struct')]),
      ],
      methods: [
        method(
          'GetBrightness',
          'float',
          0x14036f910,
          'Final | Native | Public | Const',
        ),
        method(
          'GetLightColor',
          'FLinearColor',
          0x14036f980,
          'Final | Native | Public | Const',
          [],
          [link('FLinearColor', 'struct')],
        ),
        method(
          'SetLightColor',
          'void',
          0x14036fa40,
          'Final | Native | Public | BlueprintCallable',
          [parameter('NewLightColor', 'FLinearColor', [link('FLinearColor', 'struct')])],
        ),
        method(
          'SetLightFunctionScale',
          'void',
          0x14036fac0,
          'Final | Native | Public | BlueprintCallable',
          [parameter('NewLightFunctionScale', 'FVector', [link('FVector', 'struct')])],
        ),
        method(
          'SetLightFunctionMaterial',
          'void',
          0x14036fb50,
          'Final | Native | Public | BlueprintCallable',
          [
            parameter('NewLightFunctionMaterial', 'UMaterialInterface*', [
              link('UMaterialInterface', 'class'),
            ]),
          ],
        ),
      ],
      related: [
        relation('ULightComponent', 'class', 'field', 'LightComponent'),
        relation('FLinearColor', 'struct', 'field', 'BloomTint'),
        relation('FLinearColor', 'struct', 'return', 'GetLightColor'),
        relation('FLinearColor', 'struct', 'parameter', 'SetLightColor(NewLightColor)'),
        relation('FVector', 'struct', 'parameter', 'SetLightFunctionScale(NewLightFunctionScale)'),
        relation(
          'UMaterialInterface',
          'class',
          'parameter',
          'SetLightFunctionMaterial(NewLightFunctionMaterial)',
        ),
      ],
      incomingRefs: [
        relation('ULightComponent', 'class', 'field', 'Owner'),
        relation('ULightComponent', 'class', 'return', 'GetOwner'),
      ],
    }),
  ],
  [
    'AActor',
    createDetail({
      name: 'AActor',
      kind: 'class',
      size: 656,
      parent: 'UObject',
      parents: [link('UObject', 'class')],
      directChildren: [link('ABrush', 'class'), link('AInfo', 'class'), link('APawn', 'class')],
    }),
  ],
  [
    'ABrush',
    createDetail({
      name: 'ABrush',
      kind: 'class',
      size: 720,
      parent: 'AActor',
      parents: [link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [link('AVolume', 'class')],
    }),
  ],
  [
    'AVolume',
    createDetail({
      name: 'AVolume',
      kind: 'class',
      size: 768,
      parent: 'ABrush',
      parents: [link('ABrush', 'class'), link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [link('AAudioVolume', 'class')],
    }),
  ],
  [
    'AInfo',
    createDetail({
      name: 'AInfo',
      kind: 'class',
      size: 688,
      parent: 'AActor',
      parents: [link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [link('ALight', 'class'), link('AGameModeBase', 'class'), link('AGameStateBase', 'class')],
    }),
  ],
  [
    'ADirectionalLight',
    createDetail({
      name: 'ADirectionalLight',
      kind: 'class',
      size: 832,
      parent: 'ALight',
      parents: [link('ALight', 'class'), link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'APointLight',
    createDetail({
      name: 'APointLight',
      kind: 'class',
      size: 848,
      parent: 'ALight',
      parents: [link('ALight', 'class'), link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'ARectLight',
    createDetail({
      name: 'ARectLight',
      kind: 'class',
      size: 864,
      parent: 'ALight',
      parents: [link('ALight', 'class'), link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'ASpotLight',
    createDetail({
      name: 'ASpotLight',
      kind: 'class',
      size: 848,
      parent: 'ALight',
      parents: [link('ALight', 'class'), link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'UObject',
    createDetail({
      name: 'UObject',
      kind: 'class',
      size: 40,
      directChildren: [link('AActor', 'class'), link('UVisual', 'class'), link('UWorld', 'class')],
    }),
  ],
  [
    'FReverbSettings',
    createDetail({
      name: 'FReverbSettings',
      kind: 'struct',
      size: 0x20,
      fields: [
        field('bApplyReverb', 'bool', 0x0, 1),
        field('ReverbEffect', 'UReverbEffect*', 0x8, 8),
        field('Volume', 'float', 0x18, 4),
        field('FadeTime', 'float', 0x1c, 4),
      ],
    }),
  ],
  [
    'FAudioVolumeSubmixSendSettings',
    createDetail({
      name: 'FAudioVolumeSubmixSendSettings',
      kind: 'struct',
      size: 0x28,
      fields: [
        field('ListenerLocationState', 'uint8', 0x0, 1),
        field('SourceLocationState', 'uint8', 0x1, 1),
        field('SendLevelControlMethod', 'uint8', 0x2, 1),
        field('MinSendLevel', 'float', 0x10, 4),
        field('MaxSendLevel', 'float', 0x14, 4),
      ],
    }),
  ],
  [
    'FAudioVolumeSubmixOverrideSettings',
    createDetail({
      name: 'FAudioVolumeSubmixOverrideSettings',
      kind: 'struct',
      size: 0x30,
      fields: [
        field('Submix', 'USoundSubmix*', 0x0, 8),
        field('bApplyEffects', 'bool', 0x8, 1),
        field('bChanged', 'bool', 0x9, 1),
        field('CrossfadeTime', 'float', 0x10, 4),
      ],
    }),
  ],
  [
    'FInteriorSettings',
    createDetail({
      name: 'FInteriorSettings',
      kind: 'struct',
      size: 0x28,
      fields: [
        field('InteriorVolume', 'float', 0x0, 4),
        field('InteriorTime', 'float', 0x4, 4),
        field('ExteriorVolume', 'float', 0x8, 4),
        field('ExteriorTime', 'float', 0xc, 4),
      ],
    }),
  ],
  [
    'FLinearColor',
    createDetail({
      name: 'FLinearColor',
      kind: 'struct',
      size: 16,
      fields: [
        field('R', 'float', 0x0, 4),
        field('G', 'float', 0x4, 4),
        field('B', 'float', 0x8, 4),
        field('A', 'float', 0xc, 4),
      ],
    }),
  ],
  [
    'FVector',
    createDetail({
      name: 'FVector',
      kind: 'struct',
      size: 24,
      fields: [
        field('X', 'double', 0x0, 8),
        field('Y', 'double', 0x8, 8),
        field('Z', 'double', 0x10, 8),
      ],
    }),
  ],
  [
    'ULightComponent',
    createDetail({
      name: 'ULightComponent',
      kind: 'class',
      size: 1112,
      parent: 'USceneComponent',
      parents: [link('USceneComponent', 'class'), link('UObject', 'class')],
      fields: [
        field('Intensity', 'float', 0x200, 4),
        field('LightColor', 'FLinearColor', 0x210, 16, [link('FLinearColor', 'struct')]),
        field('AttenuationRadius', 'float', 0x224, 4),
      ],
    }),
  ],
  [
    'UMaterialInterface',
    createDetail({
      name: 'UMaterialInterface',
      kind: 'class',
      size: 112,
      parent: 'UObject',
      parents: [link('UObject', 'class')],
    }),
  ],
  [
    'UVisual',
    createDetail({
      name: 'UVisual',
      kind: 'class',
      size: 48,
      parent: 'UObject',
      parents: [link('UObject', 'class')],
      directChildren: [link('UWidget', 'class')],
      fields: [field('Visibility', 'uint8', 0x28, 1)],
    }),
  ],
  [
    'UWidget',
    createDetail({
      name: 'UWidget',
      kind: 'class',
      size: 736,
      parent: 'UVisual',
      parents: [link('UVisual', 'class'), link('UObject', 'class')],
      directChildren: [link('UUserWidget', 'class')],
      fields: [
        field('RenderOpacity', 'float', 0x90, 4),
        field('bIsEnabled', 'bool', 0x94, 1),
      ],
    }),
  ],
  [
    'UUserWidget',
    createDetail({
      name: 'UUserWidget',
      kind: 'class',
      size: 712,
      parent: 'UWidget',
      parents: [link('UWidget', 'class'), link('UVisual', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'UWorld',
    createDetail({
      name: 'UWorld',
      kind: 'class',
      size: 1728,
      parent: 'UObject',
      parents: [link('UObject', 'class')],
      fields: [
        field('PersistentLevel', 'ULevel*', 0x30, 8, [link('ULevel', 'class')]),
        field('GameInstance', 'UGameInstance*', 0x38, 8, [link('UGameInstance', 'class')]),
      ],
    }),
  ],
  [
    'ULevel',
    createDetail({
      name: 'ULevel',
      kind: 'class',
      size: 1360,
      parent: 'UObject',
      parents: [link('UObject', 'class')],
    }),
  ],
  [
    'UGameInstance',
    createDetail({
      name: 'UGameInstance',
      kind: 'class',
      size: 416,
      parent: 'UObject',
      parents: [link('UObject', 'class')],
      directChildren: [link('UMWGameInstance', 'class')],
    }),
  ],
  [
    'UMWGameInstance',
    createDetail({
      name: 'UMWGameInstance',
      kind: 'class',
      size: 440,
      parent: 'UGameInstance',
      parents: [link('UGameInstance', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'UGameViewportClient',
    createDetail({
      name: 'UGameViewportClient',
      kind: 'class',
      size: 624,
      parent: 'UScriptViewportClient',
      parents: [link('UScriptViewportClient', 'class'), link('UObject', 'class')],
      directChildren: [link('UMWGameViewportClient', 'class')],
    }),
  ],
  [
    'UMWGameViewportClient',
    createDetail({
      name: 'UMWGameViewportClient',
      kind: 'class',
      size: 648,
      parent: 'UGameViewportClient',
      parents: [link('UGameViewportClient', 'class'), link('UScriptViewportClient', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'ULocalPlayer',
    createDetail({
      name: 'ULocalPlayer',
      kind: 'class',
      size: 416,
      parent: 'UPlayer',
      parents: [link('UPlayer', 'class'), link('UObject', 'class')],
      directChildren: [link('UMWLocalPlayer', 'class')],
    }),
  ],
  [
    'UMWLocalPlayer',
    createDetail({
      name: 'UMWLocalPlayer',
      kind: 'class',
      size: 432,
      parent: 'ULocalPlayer',
      parents: [link('ULocalPlayer', 'class'), link('UPlayer', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'AController',
    createDetail({
      name: 'AController',
      kind: 'class',
      size: 1120,
      parent: 'AActor',
      parents: [link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [link('APlayerController', 'class')],
    }),
  ],
  [
    'APlayerController',
    createDetail({
      name: 'APlayerController',
      kind: 'class',
      size: 2104,
      parent: 'AController',
      parents: [link('AController', 'class'), link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [link('AMWPlayerController', 'class')],
      fields: [
        field('AcknowledgedPawn', 'APawn*', 0x4d8, 8, [link('APawn', 'class')]),
        field('PlayerCameraManager', 'APlayerCameraManager*', 0x4e0, 8),
        field('StateName', 'FName', 0x4e8, 8),
      ],
      methods: [
        method(
          'GetPawn',
          'APawn*',
          0x1402bce10,
          'Final | Native | Public | Const',
          [],
          [link('APawn', 'class')],
        ),
        method(
          'SetCinematicMode',
          'void',
          0x1402bd350,
          'Final | Native | Public',
          [
            parameter('bInCinematicMode', 'bool'),
            parameter('bHidePlayer', 'bool'),
            parameter('bAffectsHUD', 'bool'),
          ],
        ),
      ],
    }),
  ],
  [
    'AMWPlayerController',
    createDetail({
      name: 'AMWPlayerController',
      kind: 'class',
      size: 2144,
      parent: 'APlayerController',
      parents: [link('APlayerController', 'class'), link('AController', 'class'), link('AActor', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'APawn',
    createDetail({
      name: 'APawn',
      kind: 'class',
      size: 904,
      parent: 'AActor',
      parents: [link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [link('ACharacter', 'class')],
    }),
  ],
  [
    'ACharacter',
    createDetail({
      name: 'ACharacter',
      kind: 'class',
      size: 944,
      parent: 'APawn',
      parents: [link('APawn', 'class'), link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [link('AMWPlayerCharacter', 'class')],
    }),
  ],
  [
    'AMWPlayerCharacter',
    createDetail({
      name: 'AMWPlayerCharacter',
      kind: 'class',
      size: 1128,
      parent: 'ACharacter',
      parents: [link('ACharacter', 'class'), link('APawn', 'class'), link('AActor', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'AGameModeBase',
    createDetail({
      name: 'AGameModeBase',
      kind: 'class',
      size: 768,
      parent: 'AInfo',
      parents: [link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [link('AMWGameMode', 'class')],
    }),
  ],
  [
    'AMWGameMode',
    createDetail({
      name: 'AMWGameMode',
      kind: 'class',
      size: 800,
      parent: 'AGameModeBase',
      parents: [link('AGameModeBase', 'class'), link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'AGameStateBase',
    createDetail({
      name: 'AGameStateBase',
      kind: 'class',
      size: 720,
      parent: 'AInfo',
      parents: [link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [link('AMWGameState', 'class')],
    }),
  ],
  [
    'AMWGameState',
    createDetail({
      name: 'AMWGameState',
      kind: 'class',
      size: 752,
      parent: 'AGameStateBase',
      parents: [link('AGameStateBase', 'class'), link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
    }),
  ],
  [
    'APlayerState',
    createDetail({
      name: 'APlayerState',
      kind: 'class',
      size: 656,
      parent: 'AInfo',
      parents: [link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
      directChildren: [link('AMWPlayerState', 'class')],
    }),
  ],
  [
    'AMWPlayerState',
    createDetail({
      name: 'AMWPlayerState',
      kind: 'class',
      size: 688,
      parent: 'APlayerState',
      parents: [link('APlayerState', 'class'), link('AInfo', 'class'), link('AActor', 'class'), link('UObject', 'class')],
    }),
  ],
])

const previewScenarioSearchQuery: Record<PreviewScenario, string> = {
  main: '',
  relation: 'ALight',
  framework: 'APlayer',
  workspace: '',
  games: '',
}

const previewScenarioLandingSymbol: Record<PreviewScenario, string> = {
  main: 'AAudioVolume',
  relation: 'ALight',
  framework: 'APlayerController',
  workspace: 'APlayerController',
  games: 'AAudioVolume',
}

export function getPreviewInitialQuery(scenario: PreviewScenario) {
  return previewScenarioSearchQuery[scenario]
}

export function getPreviewSummary(scenario: PreviewScenario): PreviewLoadSummary {
  return {
    sourceLabel:
      scenario === 'games' ? 'GitHub Games / Rocket League' : 'Bundled Sample Preview',
    symbolCount: 11601,
    classCount: 6038,
    structCount: 5180,
    enumCount: 383,
    functionOwnerCount: 2942,
    methodCount: 14137,
    relationCount: 30048,
    offsets: [
      { key: 'GWorld', value: '0x0864E8F0' },
      { key: 'GNames', value: '0x0842A100' },
      { key: 'ProcessEvent', value: '0x1401D2A30' },
    ],
    landingSymbol: previewScenarioLandingSymbol[scenario],
  }
}

export function searchPreviewSymbols(query: string, limit = 120) {
  const normalizedQuery = query.trim().toLowerCase()
  const filteredResults = normalizedQuery
    ? previewSearchResults.filter((result) => {
        return (
          result.name.toLowerCase().includes(normalizedQuery) ||
          result.subtitle.toLowerCase().includes(normalizedQuery)
        )
      })
    : previewSearchResults

  return filteredResults.slice(0, limit)
}

export function getPreviewSymbolDetail(name: string) {
  return previewDetails.get(name) ?? null
}

const previewWorkspaceDocument: PreviewWorkspaceDocument = {
  id: 'workspace-preview-player-graph',
  title: 'Player Spawn Graph',
  sourceLabel: 'Bundled Sample Preview',
  createdAtMs: 1760000000000,
  updatedAtMs: 1760003600000,
  nodes: [
    {
      id: 'node-player-controller',
      symbolName: 'APlayerController',
      x: 92,
      y: 220,
      selectedFieldNames: ['AcknowledgedPawn'],
    },
    {
      id: 'node-pawn',
      symbolName: 'APawn',
      x: 520,
      y: 244,
      selectedFieldNames: [],
    },
    {
      id: 'node-character',
      symbolName: 'ACharacter',
      x: 904,
      y: 196,
      selectedFieldNames: [],
    },
  ],
  edges: [
    {
      id: 'edge-controller-pawn',
      sourceNodeId: 'node-player-controller',
      sourceHandleId: 'field-APlayerController::AcknowledgedPawn',
      targetNodeId: 'node-pawn',
      label: 'AcknowledgedPawn',
      kind: 'field',
    },
    {
      id: 'edge-character-pawn',
      sourceNodeId: 'node-character',
      targetNodeId: 'node-pawn',
      label: 'inherits',
      kind: 'parent',
    },
  ],
}

export function getPreviewWorkspaceSummaries(): PreviewWorkspaceSummary[] {
  return [
    {
      id: previewWorkspaceDocument.id,
      title: previewWorkspaceDocument.title,
      sourceLabel: previewWorkspaceDocument.sourceLabel,
      updatedAtMs: previewWorkspaceDocument.updatedAtMs,
      nodeCount: previewWorkspaceDocument.nodes.length,
      edgeCount: previewWorkspaceDocument.edges.length,
      path: 'preview/player-spawn-graph.json',
    },
  ]
}

export function getPreviewWorkspaceDocument(workspaceId: string) {
  return workspaceId === previewWorkspaceDocument.id ? previewWorkspaceDocument : null
}

export function getPreviewGameCatalog() {
  return {
    games: [
      {
        hash: 'preview-rocketleague',
        name: 'Rocket League',
        engine: 'Unreal-Engine-3',
        location: 'Rocket-League',
        uploaded: 1760000000000,
        uploader: {
          name: 'Spuckwaffel',
          link: 'https://github.com/Spuckwaffel',
        },
      },
      {
        hash: 'preview-splitgate',
        name: 'Splitgate',
        engine: 'Unreal-Engine-4',
        location: 'Splitgate',
        uploaded: 1759910000000,
        uploader: {
          name: 'Spuckwaffel',
          link: 'https://github.com/Spuckwaffel',
        },
      },
      {
        hash: 'preview-thefinals',
        name: 'THE FINALS',
        engine: 'Unreal-Engine-5',
        location: 'THE-FINALS',
        uploaded: 1759800000000,
        uploader: {
          name: 'Spuckwaffel',
          link: 'https://github.com/Spuckwaffel',
        },
      },
    ],
  }
}
