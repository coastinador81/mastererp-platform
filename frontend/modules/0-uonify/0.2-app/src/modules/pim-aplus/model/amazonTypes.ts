/**
 * Forma de los documentos A+ de Amazon (SP-API A+ Content, contentDocument) que
 * devuelve el backend en /amazon/aplus/list, /search y /detail. Todo opcional: el
 * frontend los lee con cuidado, como el original.
 */
export interface AmazonText {
  value?: string;
}

export interface AmazonTextList {
  textList?: AmazonText[];
}

export interface AmazonImage {
  uploadDestinationId?: string;
  altText?: string;
  imageCropSpecification?: {
    size?: { width?: { value?: number; units?: string }; height?: { value?: number; units?: string } };
  };
}

export interface AmazonTextItem {
  position?: number;
  text?: AmazonText;
  value?: string;
}

export interface AmazonImageTextBlock {
  image?: AmazonImage;
  headline?: AmazonText;
  body?: AmazonTextList;
}

export interface AmazonContentModule {
  contentModuleType?: string;
  standardImageTextOverlay?: { overlayColorType?: string; block?: AmazonImageTextBlock };
  standardSingleImageSpecsDetail?: {
    headline?: AmazonText;
    image?: AmazonImage;
    descriptionHeadline?: AmazonText;
    descriptionBlock1?: { headline?: AmazonText; body?: AmazonTextList };
    descriptionBlock2?: { headline?: AmazonText; body?: AmazonTextList };
    specificationHeadline?: AmazonText;
    specificationListBlock?: { headline?: AmazonText; block?: { textList?: AmazonTextItem[] } };
    specificationTextBlock?: { headline?: AmazonText; body?: AmazonTextList };
  };
  standardFourImageText?: {
    headline?: AmazonText;
    block1?: AmazonImageTextBlock;
    block2?: AmazonImageTextBlock;
    block3?: AmazonImageTextBlock;
    block4?: AmazonImageTextBlock;
  };
  standardHeaderImageText?: { headline?: AmazonText; block?: AmazonImageTextBlock };
}

export interface AmazonContentDocument {
  name?: string;
  contentType?: string;
  contentSubType?: string;
  locale?: string;
  contentModuleList?: AmazonContentModule[];
}

export interface AmazonContentMetadata {
  name?: string;
  marketplaceId?: string;
  status?: string;
  badgeSet?: string[];
  updateTime?: string;
  brandName?: string;
  contentReferenceKey?: string;
  [field: string]: unknown;
}

export interface AmazonContentRecord {
  contentReferenceKey?: string;
  contentMetadata?: AmazonContentMetadata;
  contentDocument?: AmazonContentDocument;
}

/** Elemento de `filtered` en /amazon/aplus/list (contenido publicado del ASIN). */
export interface AmazonListItem {
  contentReferenceKey?: string;
  contentRecord?: AmazonContentRecord;
  payload?: { contentRecord?: AmazonContentRecord };
}

/** Elemento de `contentMetadataRecords` en /amazon/aplus/search. */
export interface AmazonMetadataRecord {
  contentReferenceKey?: string;
  contentMetadata?: AmazonContentMetadata;
}
