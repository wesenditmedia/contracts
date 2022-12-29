// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library WeSenditMath {
    /**
     * Calculates the power for the given parameters.
     *
     * @param base uint256 - Base
     * @param exponent uint256 - Exponent
     * @param precision uint256 - Precision used for calculation
     *
     * @return result uint256 - Calculation result
     */
    function power(
        uint256 base,
        uint256 exponent,
        uint256 precision
    ) internal pure returns (uint256 result) {
        if (exponent == 0) {
            return 10 ** precision;
        } else if (exponent == 1) {
            return base;
        } else {
            uint256 answer = base;
            for (uint256 i = 0; i < exponent; i++) {
                answer = (answer * base) / (10 ** precision);
            }
            return answer;
        }
    }
}
