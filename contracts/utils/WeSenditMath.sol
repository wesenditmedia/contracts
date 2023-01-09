// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Trigonometry.sol";

library WeSenditMath {
    /**
     * Calculates staking pool "pool factor" using given parameters
     *
     * @param balance uint256 - Pool balance in wei
     *
     * @return result uint256 - Pool Factor
     */
    function poolFactor(
        uint256 balance
    ) internal pure returns (uint256 result) {
        uint256 pMax = 120_000_000 ether;
        uint256 pMin = 0;

        // Handle overflow
        if (balance > pMax) {
            balance = pMax;
        }

        uint256 PI = Trigonometry.PI; // / 1e13;
        uint256 bracketsOne = (pMax / 1e13) - (balance / 1e13);
        uint256 bracketsTwo = (pMax / 1e18) - (pMin / 1e18);
        uint256 division = bracketsOne / bracketsTwo;
        uint256 bracketsCos = (PI * division) / 1e5;

        uint256 cos;
        uint256 brackets;
        if (bracketsCos >= Trigonometry.PI_OVER_TWO) {
            cos = uint256(Trigonometry.cos(bracketsCos + Trigonometry.PI));
            brackets = (cos + 1e18) / (2 * 1e1);
            // Subtract cos result from brackets result, since we shifted the cos input by PI
            brackets -= (cos / 1e1);
        } else {
            cos = uint256(Trigonometry.cos(bracketsCos));
            brackets = (cos + 1e18) / (2 * 1e1);
        }

        uint256 res = brackets * (100 - 15) + (15 * 1e17);
        return res * 1e1;
    }

    /**
     * Calculates staking pool APY using given parameters
     *
     * @param duration uint256 - Staking duration in days
     * @param factor uint256 - Pool Factor (1e18)
     * @param maxDuration uint256 - Max. allowed staking duration in days
     * @param compoundInterval uint256 - Compounding interval
     *
     * @return result uint256 - Pool APY
     */
    function apy(
        uint256 duration,
        uint256 factor,
        uint256 maxDuration,
        uint256 compoundInterval
    ) internal pure returns (uint256 result) {
        // Handle overflow
        if (duration > maxDuration) {
            duration = maxDuration;
        }

        uint256 _roi = 11 * 1e4; // 110%
        uint256 _poolFactor = factor / 1e14;
        uint256 _compoundInterval = compoundInterval * 1e4;
        uint256 _duration = duration * 1e7;
        uint256 _maxDuration = maxDuration * 1e4;

        uint256 x = 1e7 + (_roi * _poolFactor) / _compoundInterval;
        uint256 y = _compoundInterval * (_duration / _maxDuration);
        uint256 pow = power(x, y / 1e7, 7);

        return pow - 1e7;
    }

    /**
     * Calculates staking pool APR using given parameters
     *
     * @param duration uint256 - Staking duration in days
     * @param factor uint256 - Pool Factor (1e18)
     * @param maxDuration uint256 - Max. allowed staking duration in days
     *
     * @return result uint256 - Pool APR
     */
    function apr(
        uint256 duration,
        uint256 factor,
        uint256 maxDuration
    ) internal pure returns (uint256 result) {
        // Handle overflow
        if (duration > maxDuration) {
            duration = maxDuration;
        }

        uint256 _roi = 11 * 1e4; // 110%
        uint256 _poolFactor = factor / 1e14;
        uint256 _duration = duration * 1e7;
        uint256 _maxDuration = maxDuration * 1e4;

        uint256 x = _roi * _poolFactor;
        uint256 y = _duration / _maxDuration;

        return (x * y) / 1e7;
    }

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
