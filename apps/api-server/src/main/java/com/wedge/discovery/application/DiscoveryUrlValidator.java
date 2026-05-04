package com.wedge.discovery.application;

import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Locale;
import org.springframework.stereotype.Component;

@Component
public class DiscoveryUrlValidator {
    private static final int MAX_URL_LENGTH = 2048;
    private static final String HTTP_SCHEME = "http";
    private static final String HTTPS_SCHEME = "https";
    private static final String LOCALHOST = "localhost";
    private static final String LOCALHOST_SUFFIX = ".localhost";
    private static final int CARRIER_GRADE_NAT_FIRST_OCTET = 100;
    private static final int CARRIER_GRADE_NAT_MIN_SECOND_OCTET = 64;
    private static final int CARRIER_GRADE_NAT_MAX_SECOND_OCTET = 127;
    private static final int IPV6_UNIQUE_LOCAL_MASK = 0xfe;
    private static final int IPV6_UNIQUE_LOCAL_PREFIX = 0xfc;

    public void validate(URI url) {
        String rawUrl = url.toString();
        if (rawUrl.length() > MAX_URL_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Discovery url is too long.");
        }
        validateScheme(url);
        validateHost(url);
    }

    private void validateScheme(URI url) {
        String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals(HTTP_SCHEME) && !scheme.equals(HTTPS_SCHEME)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Discovery url must use http or https.");
        }
        if (url.getUserInfo() != null) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Discovery url must not include user info.");
        }
    }

    private void validateHost(URI url) {
        String host = url.getHost();
        if (host == null || host.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Discovery url host is required.");
        }
        String normalizedHost = host.toLowerCase(Locale.ROOT);
        if (normalizedHost.equals(LOCALHOST) || normalizedHost.endsWith(LOCALHOST_SUFFIX)) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Discovery url host is not allowed.");
        }
        rejectPrivateOrReservedResolvedAddresses(host);
    }

    private void rejectPrivateOrReservedResolvedAddresses(String host) {
        try {
            for (InetAddress address : InetAddress.getAllByName(host)) {
                if (isBlockedAddress(address)) {
                    throw new BusinessException(ErrorCode.INVALID_REQUEST, "Discovery url host resolves to a private or reserved address.");
                }
            }
        } catch (UnknownHostException exception) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Discovery url host cannot be resolved.");
        }
    }

    private boolean isBlockedAddress(InetAddress address) {
        return address.isAnyLocalAddress()
                || address.isLoopbackAddress()
                || address.isLinkLocalAddress()
                || address.isSiteLocalAddress()
                || address.isMulticastAddress()
                || isCarrierGradeNat(address)
                || isIpv6UniqueLocal(address);
    }

    private boolean isCarrierGradeNat(InetAddress address) {
        if (!(address instanceof Inet4Address)) {
            return false;
        }
        byte[] bytes = address.getAddress();
        int first = bytes[0] & 0xff;
        int second = bytes[1] & 0xff;
        return first == CARRIER_GRADE_NAT_FIRST_OCTET
                && second >= CARRIER_GRADE_NAT_MIN_SECOND_OCTET
                && second <= CARRIER_GRADE_NAT_MAX_SECOND_OCTET;
    }

    private boolean isIpv6UniqueLocal(InetAddress address) {
        if (!(address instanceof Inet6Address)) {
            return false;
        }
        int first = address.getAddress()[0] & 0xff;
        return (first & IPV6_UNIQUE_LOCAL_MASK) == IPV6_UNIQUE_LOCAL_PREFIX;
    }
}
