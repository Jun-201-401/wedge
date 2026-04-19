package com.wedge.common.response;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

public final class RequestMetadata {
    public static final String REQUEST_ID_ATTRIBUTE = "wedge.requestId";
    public static final String CORRELATION_ID_ATTRIBUTE = "wedge.correlationId";

    private RequestMetadata() {
    }

    public static ApiMeta current() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes servletAttributes) {
            HttpServletRequest request = servletAttributes.getRequest();
            return ApiMeta.of(attribute(request, REQUEST_ID_ATTRIBUTE), attribute(request, CORRELATION_ID_ATTRIBUTE));
        }
        return ApiMeta.of(null, null);
    }

    private static String attribute(HttpServletRequest request, String name) {
        Object value = request.getAttribute(name);
        return value instanceof String text && !text.isBlank() ? text : null;
    }
}
